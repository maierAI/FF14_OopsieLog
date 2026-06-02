from __future__ import annotations

import argparse
import getpass
import os
import posixpath
import shlex
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path

try:
    import paramiko
except ModuleNotFoundError as exc:  # pragma: no cover - operator guidance
    raise SystemExit(
        "Missing dependency `paramiko`. Install it with:\n"
        "  python -m pip install -r requirements-deploy.txt"
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
REMOTE_SCRIPT = REPO_ROOT / "scripts" / "remote-deploy.sh"
LOCAL_DEPLOY_ENV = REPO_ROOT / ".deploy.local.env"

ARCHIVE_FILES = [
    "package.json",
    "package-lock.json",
]

ARCHIVE_DIRS = [
    "dist",
    "server",
]


def run_local(command: list[str], cwd: Path | None = None, env: dict[str, str] | None = None) -> None:
    if os.name == "nt" and command[0] == "npm":
        npm_executable = shutil.which("npm.cmd") or shutil.which("npm")
        if not npm_executable:
            raise FileNotFoundError("npm is not available in PATH.")
        command = [npm_executable, *command[1:]]
    subprocess.run(command, cwd=cwd or REPO_ROOT, env=env, check=True)


def load_local_deploy_env() -> None:
    if not LOCAL_DEPLOY_ENV.exists():
        return

    for raw_line in LOCAL_DEPLOY_ENV.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key or key in os.environ:
            continue
        os.environ[key] = value.strip()


def env_default(name: str, default: str) -> str:
    value = os.getenv(name)
    if value is None or value.strip() == "":
        return default
    return value


def env_int_default(name: str, default: int) -> int:
    return int(env_default(name, str(default)))


def add_path_to_tar(tar: tarfile.TarFile, base: Path, relative: str) -> None:
    source = base / relative
    if not source.exists():
        raise FileNotFoundError(f"Missing required deployment path: {source}")
    tar.add(source, arcname=relative)


def build_release_archive(release_name: str, *, run_build: bool) -> Path:
    if run_build:
        env = os.environ.copy()
        env["VITE_STORAGE_MODE"] = "api"
        run_local(["npm", "run", "build"], env=env)
    elif not (REPO_ROOT / "dist").exists():
        raise FileNotFoundError("Missing built artifacts for --skip-build: dist")

    release_archive = Path(tempfile.gettempdir()) / f"{release_name}.tar.gz"
    if release_archive.exists():
        release_archive.unlink()

    with tarfile.open(release_archive, "w:gz") as tar:
        for relative in ARCHIVE_FILES:
            add_path_to_tar(tar, REPO_ROOT, relative)
        for relative in ARCHIVE_DIRS:
            add_path_to_tar(tar, REPO_ROOT, relative)

    return release_archive


def upload_file(sftp: paramiko.SFTPClient, local_path: Path, remote_path: str) -> None:
    remote_dir = posixpath.dirname(remote_path)
    try:
        sftp.stat(remote_dir)
    except FileNotFoundError:
        parts = remote_dir.strip("/").split("/")
        current = ""
        for part in parts:
            current = f"{current}/{part}" if current else f"/{part}"
            try:
                sftp.stat(current)
            except FileNotFoundError:
                sftp.mkdir(current)
    sftp.put(str(local_path), remote_path)


def run_remote(ssh: paramiko.SSHClient, command: str) -> None:
    stdin, stdout, stderr = ssh.exec_command(command)
    exit_code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    if out:
        print(out)
    if err:
        print(err, file=sys.stderr)
    if exit_code != 0:
        raise RuntimeError(f"Remote command failed with exit code {exit_code}: {command}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build and deploy FF14 OopsieLog to a remote Linux host.")
    parser.add_argument("--host", default=env_default("DEPLOY_HOST", ""))
    parser.add_argument("--user", default=env_default("DEPLOY_USER", "root"))
    parser.add_argument("--password", default=env_default("DEPLOY_PASSWORD", ""))
    parser.add_argument("--key-file", default=env_default("DEPLOY_KEY_FILE", ""))
    parser.add_argument("--port", type=int, default=env_int_default("DEPLOY_PORT", 22))
    parser.add_argument("--app-dir", default=env_default("DEPLOY_APP_DIR", "/www/wwwroot/ff14_oopsie_dev"))
    parser.add_argument("--service-name", default=env_default("DEPLOY_SERVICE_NAME", "ff14-oopsie-dev"))
    parser.add_argument("--node-version", default=env_default("DEPLOY_NODE_VERSION", "22"))
    parser.add_argument("--app-port", type=int, default=env_int_default("DEPLOY_APP_PORT", 3101))
    parser.add_argument("--app-host", default=env_default("DEPLOY_APP_HOST", "127.0.0.1"))
    parser.add_argument("--skip-build", action="store_true")
    return parser.parse_args()


def main() -> None:
    load_local_deploy_env()
    args = parse_args()
    if not args.host:
        raise SystemExit("Missing required deploy host. Set DEPLOY_HOST or pass --host.")

    release_name = datetime.now(timezone.utc).strftime("release-%Y%m%d-%H%M%S")
    archive_path = build_release_archive(release_name, run_build=not args.skip_build)

    remote_tmp_dir = f"/tmp/{args.service_name}-{release_name}"
    remote_archive = f"{remote_tmp_dir}/release.tar.gz"
    remote_script = f"{remote_tmp_dir}/remote-deploy.sh"

    print(f"Deploying {release_name} to {args.user}@{args.host}:{args.app_dir}")
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    connect_kwargs = {
        "hostname": args.host,
        "port": args.port,
        "username": args.user,
        "timeout": 30,
    }
    if args.password:
        connect_kwargs["password"] = args.password
        connect_kwargs["allow_agent"] = False
        connect_kwargs["look_for_keys"] = False
    elif args.key_file:
        connect_kwargs["key_filename"] = args.key_file
        connect_kwargs["allow_agent"] = True
        connect_kwargs["look_for_keys"] = False
    else:
        connect_kwargs["allow_agent"] = True
        connect_kwargs["look_for_keys"] = True

    try:
        ssh.connect(**connect_kwargs)
    except paramiko.ssh_exception.AuthenticationException:
        if args.password or args.key_file:
            raise
        password = getpass.getpass(f"SSH password for {args.user}@{args.host}: ")
        ssh.connect(
            args.host,
            port=args.port,
            username=args.user,
            password=password,
            timeout=30,
            allow_agent=False,
            look_for_keys=False,
        )

    try:
        run_remote(ssh, f"mkdir -p {shlex.quote(remote_tmp_dir)}")
        sftp = ssh.open_sftp()
        try:
            upload_file(sftp, archive_path, remote_archive)
            upload_file(sftp, REMOTE_SCRIPT, remote_script)
        finally:
            sftp.close()

        run_remote(ssh, f"chmod +x {shlex.quote(remote_script)}")
        deploy_command = " ".join(
            shlex.quote(value)
            for value in [
                "bash",
                remote_script,
                args.app_dir,
                release_name,
                remote_archive,
                args.service_name,
                args.node_version,
                str(args.app_port),
                args.app_host,
            ]
        )
        run_remote(ssh, deploy_command)
        run_remote(ssh, f"rm -rf {shlex.quote(remote_tmp_dir)}")
    finally:
        ssh.close()
        if archive_path.exists():
            archive_path.unlink()


if __name__ == "__main__":
    main()
