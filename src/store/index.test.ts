import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useAppStore } from './index';

describe('App Store Player State Machine', () => {
  const originalRandomUUID = globalThis.crypto.randomUUID;

  beforeEach(() => {
    // Reset store before each test
    useAppStore.setState({
      bossProfiles: [],
      teams: [],
      mistakes: [],
      activeTeamId: ''
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: originalRandomUUID,
      configurable: true,
    });
  });

  it('should auto-bench existing on_field player with same role when a new player is added to on_field', () => {
    const store = useAppStore.getState();
    store.addTeam({ name: 'Test Team', bossId: 'b1', players: [] });
    const teamId = useAppStore.getState().teams[0].id;

    // Add first MT
    useAppStore.getState().addPlayerToTeam(teamId, {
      name: 'MT 1',
      role: 'MT',
      job: 'DRK',
      status: 'on_field'
    });

    const players1 = useAppStore.getState().teams[0].players;
    expect(players1.length).toBe(1);
    expect(players1[0].status).toBe('on_field');

    // Add second MT to on_field
    useAppStore.getState().addPlayerToTeam(teamId, {
      name: 'MT 2',
      role: 'MT',
      job: 'GNB',
      status: 'on_field'
    });

    const players2 = useAppStore.getState().teams[0].players;
    expect(players2.length).toBe(2);
    
    const mt1 = players2.find(p => p.name === 'MT 1');
    const mt2 = players2.find(p => p.name === 'MT 2');

    // The first MT should now be benched
    expect(mt1?.status).toBe('benched');
    expect(mt2?.status).toBe('on_field');
  });

  it('should mask player history when deleted', () => {
    const store = useAppStore.getState();
    store.addTeam({ name: 'Test Team', bossId: 'b1', players: [] });
    const teamId = useAppStore.getState().teams[0].id;

    // Add player
    useAppStore.getState().addPlayerToTeam(teamId, {
      name: 'To Be Deleted',
      role: 'D1',
      job: 'SAM',
      status: 'on_field'
    });

    const playerId = useAppStore.getState().teams[0].players[0].id;

    // Add mistake
    useAppStore.getState().addMistake({
      teamId,
      partId: 'p1',
      mechanicId: 'm1',
      errorPointId: 'e1',
      playerId,
      date: '2026-06-01',
      roundTime: '',
      note: '',
      pullNumber: 1
    });

    expect(useAppStore.getState().mistakes[0].playerId).toBe(playerId);

    // Delete player
    useAppStore.getState().deletePlayerFromTeam(teamId, playerId);

    const playersAfter = useAppStore.getState().teams[0].players;
    expect(playersAfter.length).toBe(0);

    const mistakeAfter = useAppStore.getState().mistakes[0];
    expect(mistakeAfter.playerId).not.toBe(playerId);
    expect(mistakeAfter.playerId).toMatch(/^删除玩家_[A-Z0-9]{4}$/);
  });

  it('should still create records when randomUUID is unavailable', () => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
    });

    const store = useAppStore.getState();
    store.addTeam({ name: 'Fallback Team', bossId: 'boss-1', players: [] });

    const createdTeam = useAppStore.getState().teams[0];
    expect(createdTeam.name).toBe('Fallback Team');
    expect(createdTeam.id).toMatch(/^[a-z0-9-]+$/i);
  });
});
