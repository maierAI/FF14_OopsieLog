import { create } from 'zustand';
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware';
import { getWorkspaceScopedStorageKey, getWorkspaceSession } from '../utils/session';
import { fetchJson } from '../utils/http';
import { resolveRemoteStorageValue } from './persistence';

const apiStorage: StateStorage = {
  getItem: async (name: string): Promise<string | null> => {
    const session = getWorkspaceSession();
    const scopedKey = getWorkspaceScopedStorageKey(name);
    const fallbackValue = localStorage.getItem(scopedKey);

    if (!session) {
      return fallbackValue;
    }

    try {
      const params = new URLSearchParams({
        key: scopedKey,
        workspaceId: session.workspaceId,
        actorPasscode: session.passcode
      });
      const data = await fetchJson<{ value: unknown }>('/api/store?' + params.toString());
      return resolveRemoteStorageValue(data.value, fallbackValue);
    } catch (e) {
      console.error('API Fetch error:', e);
    }
    return fallbackValue;
  },
  setItem: async (name: string, value: string): Promise<void> => {
    const session = getWorkspaceSession();
    const scopedKey = getWorkspaceScopedStorageKey(name);

    localStorage.setItem(scopedKey, value); // Fallback local write
    if (!session) {
      return;
    }

    try {
      await fetchJson<{ success: boolean }>('/api/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: session.workspaceId,
          actorPasscode: session.passcode,
          key: scopedKey,
          value: JSON.parse(value)
        })
      });
    } catch (e) {
      console.error('API Save error:', e);
    }
  },
  removeItem: async (name: string): Promise<void> => {
    localStorage.removeItem(getWorkspaceScopedStorageKey(name));
  }
};

const storageMode = import.meta.env.VITE_STORAGE_MODE;
const storageEngine = storageMode === 'local' ? localStorage : apiStorage;

export interface ErrorPoint {
  id: string;
  name: string;
  isDeleted: boolean; // 软删除标记
}

export interface Mechanic {
  id: string;
  shortName: string;
  officialName: string;
  startTime: string;
  endTime: string;
  notes: string;
  errorPoints: ErrorPoint[];
}

export interface BossPart {
  id: string;
  name: string;
  maxDuration: string;
  mechanics: Mechanic[];
}

export interface BossProfile {
  id: string;
  name: string;
  parts: BossPart[];
}

export type PlayerStatus = 'on_field' | 'benched' | 'left';

export interface Player {
  id: string;
  role: string; // 'MT' | 'ST' | 'H1' | 'H2' | 'D1' | 'D2' | 'D3' | 'D4' | string
  name: string;
  job: string;
  status: PlayerStatus;
}

export interface Team {
  id: string;
  name: string;
  bossId: string;
  players: Player[];
  captainUserId?: string;
  dayResetTime?: string;
  errorLevels?: string[];
  celebrationMode?: boolean;
  celebrationAllowance?: number;
}

export interface MistakeRecord {
  id: string;
  teamId: string;
  date: string;
  timestamp: number;
  partId: string;
  mechanicId: string;
  errorPointId: string;
  playerId: string;
  roundTime: string; // 本轮时间
  note: string;      // 备注
  pullNumber: number; // 记录对应的把数
  severity?: string;  // 错误级别
  isCelebration?: boolean; // 初见庆祝记录
  sortKey?: number; // 自定义排序主键，默认等于 timestamp
}

export interface ProgressRecord {
  id: string;
  teamId: string;
  date: string;
  maxPhase: string;
}

export interface AppState {
  bossProfiles: BossProfile[];
  teams: Team[];
  activeTeamId: string | null;
  mistakes: MistakeRecord[];
  progress: ProgressRecord[];
  isHydrated: boolean;
  
  hasSeenGuidance: boolean;
  telemetryConsent: boolean;

  // Boss Actions
  addBossProfile: (profile: Omit<BossProfile, 'id' | 'parts'>) => void;
  updateBossProfile: (id: string, profile: Partial<BossProfile>) => void;
  deleteBossProfile: (id: string) => void;
  importBossProfile: (profile: BossProfile) => void;

  // Boss Part Actions
  addBossPart: (bossId: string, partName: string) => void;
  updateBossPart: (bossId: string, partId: string, part: Partial<BossPart>) => void;
  deleteBossPart: (bossId: string, partId: string) => void;
  reorderBossParts: (bossId: string, newParts: BossPart[]) => void;

  // Mechanic Actions
  addMechanic: (bossId: string, partId: string, mechanic: Partial<Mechanic>) => void;
  updateMechanic: (bossId: string, partId: string, mechanicId: string, mechanic: Partial<Mechanic>) => void;
  deleteMechanic: (bossId: string, partId: string, mechanicId: string) => void;
  reorderMechanics: (bossId: string, partId: string, newMechanics: Mechanic[]) => void;

  // ErrorPoint Actions
  addErrorPoint: (bossId: string, partId: string, mechanicId: string, name: string) => void;
  deleteErrorPoint: (bossId: string, partId: string, mechanicId: string, errorPointId: string) => void;

  // Team Actions
  addTeam: (team: Omit<Team, 'id'>) => void;
  updateTeam: (id: string, team: Partial<Team>) => void;
  deleteTeam: (id: string) => void;
  setActiveTeam: (id: string | null) => void;
  updateTeamSettings: (id: string, settings: Partial<Team>) => void;

  // Player Actions
  addPlayerToTeam: (teamId: string, player: Omit<Player, 'id'>) => void;
  updatePlayerInTeam: (teamId: string, playerId: string, player: Partial<Player>) => void;
  deletePlayerFromTeam: (teamId: string, playerId: string) => void;

  // Record Actions
  addMistake: (mistake: Omit<MistakeRecord, 'id' | 'timestamp' | 'sortKey'>) => void;
  updateMistake: (id: string, updates: Partial<MistakeRecord>) => void;
  insertMistakes: (mistakesArray: Omit<MistakeRecord, 'id' | 'timestamp' | 'sortKey'>[], shiftSubsequent: boolean) => void;
  deleteMistake: (id: string) => void;
  reorderMistakes: (updates: { id: string; sortKey: number }[]) => void;
  saveProgress: (progress: Omit<ProgressRecord, 'id'>) => void;

  // Global I/O
  importData: (data: Partial<AppState>) => void;
  clearAllData: () => void;

  // Settings Actions
  setHasSeenGuidance: (seen: boolean) => void;
  setTelemetryConsent: (consent: boolean) => void;
  setHydrated: (hydrated: boolean) => void;
}

function genId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis.crypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      bossProfiles: [],
      teams: [],
      activeTeamId: null,
      mistakes: [],
      progress: [],
      isHydrated: false,
      hasSeenGuidance: false,
      telemetryConsent: false,

      // --- Boss Profiles ---
      addBossProfile: (profile) => set((state) => ({
        bossProfiles: [...state.bossProfiles, { ...profile, id: genId(), parts: [] }]
      })),
      updateBossProfile: (id, profile) => set((state) => ({
        bossProfiles: state.bossProfiles.map(p => p.id === id ? { ...p, ...profile } : p)
      })),
      deleteBossProfile: (id) => set((state) => ({
        bossProfiles: state.bossProfiles.filter(p => p.id !== id)
      })),
      importBossProfile: (profile) => set((state) => {
        const exists = state.bossProfiles.find(p => p.id === profile.id);
        const newProfile = exists ? { ...profile, id: genId(), name: `${profile.name} (Imported)` } : profile;
        return { bossProfiles: [...state.bossProfiles, newProfile] };
      }),

      // --- Boss Parts ---
      addBossPart: (bossId, partName) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
          ...b,
          parts: [...b.parts, { id: genId(), name: partName, maxDuration: '', mechanics: [] }]
        } : b)
      })),
      updateBossPart: (bossId, partId, part) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
          ...b,
          parts: b.parts.map(p => p.id === partId ? { ...p, ...part } : p)
        } : b)
      })),
      deleteBossPart: (bossId, partId) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
          ...b,
          parts: b.parts.filter(p => p.id !== partId)
        } : b)
      })),
      reorderBossParts: (bossId, newParts) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? { ...b, parts: newParts } : b)
      })),

      // --- Mechanics ---
      addMechanic: (bossId, partId, mechanic) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
          ...b,
          parts: b.parts.map(p => p.id === partId ? {
            ...p,
            mechanics: [...p.mechanics, { 
              id: genId(), 
              shortName: mechanic.shortName || '', 
              officialName: mechanic.officialName || '', 
              startTime: mechanic.startTime || '', 
              endTime: mechanic.endTime || '', 
              notes: mechanic.notes || '', 
              errorPoints: [
                { id: genId(), name: '理解错误', isDeleted: false },
                { id: genId(), name: '执行错误', isDeleted: false }
              ] 
            }]
          } : p)
        } : b)
      })),
      updateMechanic: (bossId, partId, mechanicId, mechanic) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
          ...b,
          parts: b.parts.map(p => p.id === partId ? {
            ...p,
            mechanics: p.mechanics.map(m => m.id === mechanicId ? { ...m, ...mechanic } : m)
          } : p)
        } : b)
      })),
      deleteMechanic: (bossId, partId, mechanicId) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
          ...b,
          parts: b.parts.map(p => p.id === partId ? {
            ...p,
            mechanics: p.mechanics.filter(m => m.id !== mechanicId)
          } : p)
        } : b)
      })),
      reorderMechanics: (bossId, partId, newMechanics) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
          ...b,
          parts: b.parts.map(p => p.id === partId ? { ...p, mechanics: newMechanics } : p)
        } : b)
      })),

      // --- Error Points ---
      addErrorPoint: (bossId, partId, mechanicId, name) => set((state) => ({
        bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
          ...b,
          parts: b.parts.map(p => p.id === partId ? {
            ...p,
            mechanics: p.mechanics.map(m => m.id === mechanicId ? {
              ...m,
              errorPoints: [...m.errorPoints, { id: genId(), name, isDeleted: false }]
            } : m)
          } : p)
        } : b)
      })),
      deleteErrorPoint: (bossId, partId, mechanicId, errorPointId) => set((state) => {
        // 检查是否有关联的记录
        const isReferenced = state.mistakes.some(m => m.errorPointId === errorPointId);

        return {
          bossProfiles: state.bossProfiles.map(b => b.id === bossId ? {
            ...b,
            parts: b.parts.map(p => p.id === partId ? {
              ...p,
              mechanics: p.mechanics.map(m => m.id === mechanicId ? {
                ...m,
                errorPoints: isReferenced 
                  ? m.errorPoints.map(ep => ep.id === errorPointId ? { ...ep, isDeleted: true } : ep)
                  : m.errorPoints.filter(ep => ep.id !== errorPointId)
              } : m)
            } : p)
          } : b)
        };
      }),

      // --- Teams & Players ---
      addTeam: (team) => set((state) => {
        const newTeam = {
          ...team,
          id: genId(),
          dayResetTime: team.dayResetTime ?? '04:00',
          errorLevels: team.errorLevels ?? ['团灭'],
          celebrationMode: team.celebrationMode ?? false,
        };
        return {
          teams: [...state.teams, newTeam],
          activeTeamId: newTeam.id
        };
      }),
      updateTeam: (id, team) => set((state) => ({
        teams: state.teams.map(t => t.id === id ? { ...t, ...team } : t)
      })),
      deleteTeam: (id) => set((state) => ({
        teams: state.teams.filter(t => t.id !== id),
        activeTeamId: state.activeTeamId === id ? null : state.activeTeamId
      })),
      setActiveTeam: (id) => set({ activeTeamId: id }),
      updateTeamSettings: (id, settings) => set((state) => ({
        teams: state.teams.map(t => t.id === id ? { ...t, ...settings } : t)
      })),

      addPlayerToTeam: (teamId, player) => set((state) => {
        return {
          teams: state.teams.map(t => {
            if (t.id !== teamId) return t;
            let updatedPlayers = [...t.players];
            // 如果新玩家上场，同位置的其他玩家变为 benched
            if (player.status === 'on_field') {
              updatedPlayers = updatedPlayers.map(p => p.role === player.role && p.status === 'on_field' ? { ...p, status: 'benched' } : p);
            }
            return {
              ...t,
              players: [...updatedPlayers, { ...player, id: genId() }]
            };
          })
        };
      }),
      updatePlayerInTeam: (teamId, playerId, playerUpdates) => set((state) => {
        return {
          teams: state.teams.map(t => {
            if (t.id !== teamId) return t;
            const targetPlayer = t.players.find(p => p.id === playerId);
            if (!targetPlayer) return t;
            
            const newRole = playerUpdates.role ?? targetPlayer.role;
            const newStatus = playerUpdates.status ?? targetPlayer.status;

            let updatedPlayers = [...t.players];
            // 顶掉同位置上场的人
            if (newStatus === 'on_field') {
              updatedPlayers = updatedPlayers.map(p => 
                (p.id !== playerId && p.role === newRole && p.status === 'on_field') 
                  ? { ...p, status: 'benched' } 
                  : p
              );
            }
            
            updatedPlayers = updatedPlayers.map(p => p.id === playerId ? { ...p, ...playerUpdates } : p);

            return {
              ...t,
              players: updatedPlayers
            };
          })
        };
      }),
      deletePlayerFromTeam: (teamId, playerId) => set((state) => {
        const deletedPrefix = `删除玩家_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        return {
          teams: state.teams.map(t => t.id === teamId ? {
            ...t,
            players: t.players.filter(p => p.id !== playerId)
          } : t),
          mistakes: state.mistakes.map(m => m.playerId === playerId ? {
            ...m,
            playerId: deletedPrefix
          } : m)
        };
      }),

      // --- Records ---
      addMistake: (mistake) => set((state) => {
        const timestamp = Date.now();
        const newRecord = { ...mistake, id: genId(), timestamp, sortKey: timestamp };
        return {
          mistakes: [...state.mistakes, newRecord]
        };
      }),
      updateMistake: (id, updates) => set((state) => ({
        mistakes: state.mistakes.map(m => m.id === id ? { ...m, ...updates } : m)
      })),
      insertMistakes: (mistakesArray, shiftSubsequent) => set((state) => {
        const timestamp = Date.now();
        let newMistakes = [...state.mistakes];
        
        if (shiftSubsequent && mistakesArray.length > 0) {
          const firstPull = Math.min(...mistakesArray.map(m => m.pullNumber));
          const date = mistakesArray[0].date;
          const teamId = mistakesArray[0].teamId;
          const shiftAmount = mistakesArray.length;
          
          newMistakes = newMistakes.map(m => {
            if (m.teamId === teamId && m.date === date && m.pullNumber >= firstPull) {
              return { ...m, pullNumber: m.pullNumber + shiftAmount };
            }
            return m;
          });
        }
        
        const toAdd = mistakesArray.map((m, i) => ({
          ...m,
          id: genId(),
          timestamp: timestamp - i, // Ensure distinct timestamps
          sortKey: timestamp - i
        }));
        
        return {
          mistakes: [...newMistakes, ...toAdd]
        };
      }),
      deleteMistake: (id) => set((state) => ({
        mistakes: state.mistakes.filter(m => m.id !== id)
      })),
      reorderMistakes: (updates) => set((state) => {
        const updateMap = new Map(updates.map(u => [u.id, u.sortKey]));
        return {
          mistakes: state.mistakes.map(m => 
            updateMap.has(m.id) ? { ...m, sortKey: updateMap.get(m.id) } : m
          )
        };
      }),
      saveProgress: (progress) => set((state) => {
        const existingIndex = state.progress.findIndex(p => p.teamId === progress.teamId && p.date === progress.date);
        if (existingIndex >= 0) {
          const newProgress = [...state.progress];
          newProgress[existingIndex] = { ...newProgress[existingIndex], ...progress };
          return { progress: newProgress };
        } else {
          return { progress: [...state.progress, { ...progress, id: genId() }] };
        }
      }),
      
      setHasSeenGuidance: (seen) => set({ hasSeenGuidance: seen }),
      setTelemetryConsent: (consent) => set({ telemetryConsent: consent }),
      setHydrated: (hydrated) => set({ isHydrated: hydrated }),

      // --- Global ---
      importData: (data) => set((state) => ({
        ...state,
        ...data,
      })),
      clearAllData: () => set({
        bossProfiles: [],
        teams: [],
        activeTeamId: null,
        mistakes: [],
        progress: []
      })
    }),
    {
      name: 'ff14oopsie-v2-storage',
      storage: createJSONStorage(() => storageEngine),
      onRehydrateStorage: () => (state, error) => {
        if (error) {
          console.error('Store rehydration failed:', error);
        }
        state?.setHydrated(true);
      }
    }
  )
);
