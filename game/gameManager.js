'use strict';
const { Player }                       = require('./player.js');
const { ROLES, RoleID, Team, buildRoleList } = require('./roles.js');

const ALL_SPECIAL_ROLES = [
  RoleID.MAFIA, RoleID.DON, RoleID.WEREWOLF,
  RoleID.PROSTITUTE, RoleID.DOCTOR, RoleID.COMMISSIONER,
  RoleID.MANIAC, RoleID.BODYGUARD, RoleID.HUNTER, RoleID.VETERAN,
  RoleID.JESTER, RoleID.EXECUTIONER, RoleID.WITCH,
];

const GamePhase = Object.freeze({
  WAITING:  'WAITING',
  NIGHT:    'NIGHT',
  DAY:      'DAY',
  VOTING:   'VOTING',
  FINISHED: 'FINISHED',
});

function ts() {
  return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

class MafiaGame {
  constructor() {
    this.phase     = GamePhase.WAITING;
    this.dayNumber = 0;

    this.settings = {
      allowedRoles:    [...ALL_SPECIAL_ROLES],
      nightTimeoutSec: 90,
      mafiaCount:      null,
    };

    this.players       = new Map();
    this.playerNumbers = new Map();
    this._nextNumber   = 1;

    this._votes          = new Map();
    this._weights        = new Map();
    this._mafiaVotes     = new Map();
    this._nominations    = new Set();
    this._voteCandidates = new Set();
    this._voteOpen       = false;

    this.events  = [];
    this.hostLog = [];
  }

  addEvent(text) {
    this.events.push({ time: ts(), text });
    if (this.events.length > 100) this.events.shift();
  }

  addHostLog(text) {
    this.hostLog.push({ time: ts(), text });
    if (this.hostLog.length > 200) this.hostLog.shift();
  }

  getPlayer(userId) { return this.players.get(String(userId)) ?? null; }
  alivePlayers()    { return [...this.players.values()].filter(p => p.isAlive); }
  aliveByRole(rid)  { return this.alivePlayers().filter(p => p.roleId === rid); }
  aliveByTeam(t)    { return this.alivePlayers().filter(p => p.team === t); }

  registerPlayer(userId, displayName, avatarHash = null) {
    if (this.players.has(userId)) return false;
    if (this.players.size >= 20)  return false;
    const num = this._nextNumber++;
    this.playerNumbers.set(userId, num);
    this.players.set(userId, new Player(userId, displayName, ROLES[RoleID.PEACEFUL], avatarHash));
    return true;
  }

  removePlayer(userId) {
    this.playerNumbers.delete(String(userId));
    return this.players.delete(String(userId));
  }

  assignRoles() {
    const ids = [...this.players.keys()];
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j], ids[i]];
    }
    const roleIds = buildRoleList(ids.length, this.settings.allowedRoles, this.settings.mafiaCount ?? null);
    ids.forEach((uid, idx) => {
      const p    = this.players.get(uid);
      p.role       = ROLES[roleIds[idx]];
      p.gameNumber = this.playerNumbers.get(uid) ?? null;
    });
  }

  checkWinner() {
    const alive  = this.alivePlayers();
    const mafia  = alive.filter(p => p.isMafiaAligned());
    const town   = alive.filter(p => p.team === Team.TOWN);
    const maniac = alive.filter(p => p.team === Team.MANIAC);

    if (maniac.length === 1 && mafia.length === 0 && town.length <= 1)
      return '**Маньяк** победил! Он уничтожил всех остальных.';
    if (mafia.length > 0 && mafia.length >= (town.length + maniac.length))
      return '**Мафия** победила! Преступники захватили контроль над городом.';
    if (mafia.length === 0 && maniac.length === 0)
      return '**Мирные жители** победили! Город очищен от преступников.';
    return null;
  }

  resetNight() {
    this._mafiaVotes.clear();
    for (const p of this.players.values()) p.resetNightState();
  }

  recordMafiaVote(voter, target) {
    this._mafiaVotes.set(voter.id, target.id);
  }

  recordNightAction(actor, target) {
    actor.nightTarget = target;
  }

  _mafiaAgreedTarget() {
    if (!this._mafiaVotes.size) return null;
    const counts = new Map();
    for (const tid of this._mafiaVotes.values())
      counts.set(tid, (counts.get(tid) ?? 0) + 1);
    const bestId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return this.players.get(bestId) ?? null;
  }

  processNight() {
    const events = [];

    for (const witch of this.aliveByRole(RoleID.WITCH)) {
      if (witch.isBlocked || !witch.nightTarget?.isAlive) continue;
      const controlled = witch.nightTarget;
      if (controlled.id === witch.witchLastTargetId) continue;
      witch.witchLastTargetId = controlled.id;
      if (witch.witchRedirectTarget) {
        controlled.nightTarget = witch.witchRedirectTarget;
      } else {
        controlled.isBlocked = true;
      }
    }

    const putaVisiting = new Map();
    for (const puta of this.aliveByRole(RoleID.PROSTITUTE)) {
      const t = puta.nightTarget;
      if (t?.isAlive && !puta.isBlocked) {
        t.isBlocked = true;
        putaVisiting.set(t.id, puta);
      }
    }

    for (const doc of this.aliveByRole(RoleID.DOCTOR)) {
      const t = doc.nightTarget;
      if (!t?.isAlive || doc.isBlocked) continue;
      if (t.id === doc.id && doc.doctorHealedSelf) continue;
      if (t.id !== doc.id && this.dayNumber - doc.doctorLastHealedNight < 2) continue;
      t.isProtected = true;
      if (t.id === doc.id) {
        doc.doctorHealedSelf = true;
      } else {
        doc.doctorLastHealedNight = this.dayNumber;
      }
    }

    for (const bg of this.aliveByRole(RoleID.BODYGUARD)) {
      const t = bg.nightTarget;
      if (t?.isAlive && !bg.isBlocked && t.id !== bg.id) {
        t.bodyguardRef = bg;
      }
    }

    for (const vet of this.aliveByRole(RoleID.VETERAN)) {
      if (!vet.isBlocked && vet.nightTarget?.id === vet.id && vet.veteranAlerts > 0) {
        vet.veteranActive = true;
        vet.veteranAlerts--;
      }
    }

    const tryKill = (attacker, target, killMsg, savedMsg) => {
      if (!target?.isAlive || !attacker.isAlive || attacker.isBlocked) return false;
      if (target.veteranActive) {
        attacker.isAlive = false;
        events.push(`Ветеран убил **${attacker.gameName}**, пришедшего к нему!`);
        return false;
      }
      if (target.bodyguardRef?.isAlive) {
        const bg = target.bodyguardRef;
        bg.isAlive = false;
        bg.bodyguardRef = null;
        events.push(`Телохранитель **${bg.gameName}** пожертвовал собой, спасая **${target.gameName}**!`);
        return false;
      }
      if (target.isProtected) {
        events.push(savedMsg);
        return false;
      }
      target.isAlive = false;
      events.push(killMsg);
      return true;
    };

    for (const comm of this.aliveByRole(RoleID.COMMISSIONER)) {
      if (!comm.commissionerArrest || !comm.isAlive || comm.isBlocked) continue;
      const t = comm.nightTarget;
      if (!t?.isAlive || !t.isMafiaAligned()) continue;
      t.isAlive = false;
      events.push(`Лучший ход! Комиссар арестовал **${t.gameName}**.`);
    }

    let mafiaTarget = this._mafiaAgreedTarget();
    if (!mafiaTarget) {
      for (const m of this.aliveByTeam(Team.MAFIA)) {
        if (m.nightTarget?.isAlive && !m.isBlocked) { mafiaTarget = m.nightTarget; break; }
      }
    }
    const firstMafioso = this.aliveByTeam(Team.MAFIA).find(m => !m.isBlocked);

    if (mafiaTarget) {
      if (mafiaTarget.isMafiaAligned()) {
        mafiaTarget.isAlive = false;
        events.push(`Мафия совершила самострел: **${mafiaTarget.gameName}** погиб.`);
      } else {
        const killed = tryKill(
          firstMafioso ?? mafiaTarget, mafiaTarget,
          `Этой ночью был убит **${mafiaTarget.gameName}**.`,
          'Этой ночью кто-то был в опасности, но выжил благодаря доктору.',
        );
        if (killed && putaVisiting.has(mafiaTarget.id)) {
          const puta = putaVisiting.get(mafiaTarget.id);
          if (puta.isAlive) {
            puta.isAlive = false;
            events.push(`Путана **${puta.gameName}** была у клиента и тоже погибла.`);
          }
        }
      }
    } else {
      events.push('Этой ночью мафия не смогла договориться — никто не погиб.');
    }

    for (const maniac of this.aliveByRole(RoleID.MANIAC)) {
      const t = maniac.nightTarget;
      if (!t?.isAlive || maniac.isBlocked) continue;
      tryKill(
        maniac, t,
        `Этой ночью маньяк убил **${t.gameName}**.`,
        'Маньяк пытался убить, но жертва выжила благодаря доктору.',
      );
    }

    for (const vet of this.aliveByRole(RoleID.VETERAN)) {
      if (!vet.veteranActive) continue;
      for (const doc of this.aliveByRole(RoleID.DOCTOR)) {
        if (doc.nightTarget?.id === vet.id && !doc.isBlocked && doc.isAlive) {
          doc.isAlive = false;
          events.push(`Ветеран убил Доктора **${doc.gameName}**, пришедшего к нему.`);
        }
      }
      for (const puta of this.aliveByRole(RoleID.PROSTITUTE)) {
        if (puta.nightTarget?.id === vet.id && puta.isAlive) {
          puta.isAlive = false;
          events.push(`Ветеран убил Путану **${puta.gameName}**, пришедшую к нему.`);
        }
      }
      for (const comm of this.aliveByRole(RoleID.COMMISSIONER)) {
        if (comm.nightTarget?.id === vet.id && !comm.isBlocked && comm.isAlive) {
          comm.isAlive = false;
          events.push(`Ветеран убил Комиссара **${comm.gameName}**, пришедшего к нему.`);
        }
      }
      for (const bg of this.aliveByRole(RoleID.BODYGUARD)) {
        if (bg.nightTarget?.id === vet.id && !bg.isBlocked && bg.isAlive) {
          bg.isAlive = false;
          events.push(`Ветеран убил Телохранителя **${bg.gameName}**, пришедшего к нему.`);
        }
      }
    }

    return events;
  }

  resetVote() {
    this._votes.clear();
    this._weights.clear();
  }

  castVote(voter, target) {
    if (!voter.isAlive)  return 'Мёртвые не голосуют.';
    if (!target.isAlive) return 'Нельзя голосовать за мёртвого игрока.';
    if (voter.id === target.id) return 'Нельзя голосовать против самого себя.';
    this._votes.set(voter.id, target.id);
    this._weights.set(voter.id, voter.role.votes);
    return `Голос за **${target.gameName}** принят.`;
  }

  tallyVotes() {
    const counts = new Map();
    for (const [vid, tid] of this._votes) {
      const w = this._weights.get(vid) ?? 1;
      counts.set(tid, (counts.get(tid) ?? 0) + w);
    }
    if (!counts.size) return null;
    const max     = Math.max(...counts.values());
    const leaders = [...counts.entries()].filter(([, v]) => v === max).map(([id]) => id);
    if (leaders.length !== 1) return null;
    return this.players.get(leaders[0]) ?? null;
  }

  voteSummary() {
    const counts = new Map();
    for (const [vid, tid] of this._votes) {
      const w = this._weights.get(vid) ?? 1;
      counts.set(tid, (counts.get(tid) ?? 0) + w);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([tid, cnt]) => ({ id: tid, name: this.players.get(tid)?.gameName ?? tid, votes: cnt }));
  }

  publicState() {
    const voteCounts = {};
    for (const [vid, tid] of this._votes) {
      const w = this._weights.get(vid) ?? 1;
      voteCounts[tid] = (voteCounts[tid] ?? 0) + w;
    }
    return {
      phase:          this.phase,
      dayNumber:      this.dayNumber,
      aliveCount:     this.alivePlayers().length,
      playerCount:    this.players.size,
      players:        [...this.players.values()].map(p => ({
        id:          p.id,
        number:      p.gameNumber,
        name:        p.gameName,
        displayName: p.displayName,
        isAlive:     p.isAlive,
        fouls:       p.fouls || 0,
        avatarUrl:   p.avatarHash ? `https://cdn.discordapp.com/avatars/${p.id}/${p.avatarHash}.png?size=128` : null,
      })),
      nominations:     [...this._nominations],
      voteCandidates:  [...this._voteCandidates],
      voteCounts,
      voteOpen:        this._voteOpen,
      settings:        this.settings,
      events:          this.events.slice(-50),
    };
  }

  hostState() {
    const roles = {};
    const mafiaVotes = {};
    const nightActions = {};

    for (const p of this.players.values()) {
      roles[p.id] = {
        roleId:  p.roleId,
        name:    p.role.name,
        emoji:   p.role.emoji,
        team:    p.team,
        isAlive: p.isAlive,
        number:  p.gameNumber,
      };
      if (p.nightTarget) {
        nightActions[p.id] = p.nightTarget.id;
      }
    }
    for (const [vid, tid] of this._mafiaVotes) {
      mafiaVotes[vid] = tid;
    }

    return { roles, mafiaVotes, nightActions, hostLog: this.hostLog.slice(-100) };
  }

  playerState(userId) {
    const p = this.players.get(userId);
    if (!p) return null;
    return {
      role: {
        id:                p.roleId,
        name:              p.role.name,
        emoji:             p.role.emoji,
        team:              p.team,
        description:       p.role.description,
        nightAction:       p.role.nightAction,
        actionDescription: p.role.actionDescription,
      },
      isAlive:        p.isAlive,
      gameNumber:     p.gameNumber,
      myVote:         this._votes.get(userId) ?? null,
      nightTargetSet: p.nightTarget !== null,
      mafiaVoteSet:   this._mafiaVotes.has(userId),
      veteranAlerts:  p.veteranAlerts,
    };
  }
}

module.exports = { MafiaGame, GamePhase };
