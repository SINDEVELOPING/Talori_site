'use strict';
const { Team, RoleID } = require('./roles.js');

class Player {
  constructor(userId, displayName, role, avatarHash = null) {
    this.id          = userId;
    this._displayName = displayName;
    this.role        = role;
    this.avatarHash  = avatarHash;
    this.isAlive     = true;
    this.gameNumber  = null;

    this.nightTarget     = null;
    this.isBlocked       = false;
    this.isProtected     = false;
    this.bodyguardRef    = null;
    this.veteranActive   = false;
    this.witchRedirectTarget = null;
    this.commissionerArrest  = false;

    this.fouls               = 0;

    this.veteranAlerts       = 3;
    this.witchLastTargetId   = null;
    this.doctorHealedSelf    = false;
    this.doctorLastHealedNight = 0;
    this.executionerTargetId = null;
    this.executionerWon      = false;
    this.hunterUsed          = false;
  }

  get displayName() { return this._displayName; }
  get gameName()    { return this.gameNumber != null ? `Игрок ${this.gameNumber}` : this._displayName; }
  get team()        { return this.role.team; }
  get roleId()      { return this.role.id; }

  isMafiaAligned() { return this.team === Team.MAFIA; }

  isDetectedByCommissioner() {
    if (this.roleId === RoleID.WEREWOLF) return false;
    if (this.team  === Team.MAFIA)       return true;
    if (this.roleId === RoleID.MANIAC)   return true;
    if (this.roleId === RoleID.WITCH)    return true;
    return false;
  }

  resetNightState() {
    this.isBlocked           = false;
    this.isProtected         = false;
    this.nightTarget         = null;
    this.bodyguardRef        = null;
    this.veteranActive       = false;
    this.witchRedirectTarget = null;
    this.commissionerArrest  = false;
  }
}

module.exports = { Player };
