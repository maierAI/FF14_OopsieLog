export function resolveRemoteStorageValue(
  value: unknown,
  fallbackValue: string | null
): string | null {
  if (value == null) {
    return fallbackValue;
  }

  return JSON.stringify(value);
}
