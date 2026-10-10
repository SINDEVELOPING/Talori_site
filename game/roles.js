'use strict';

const Team = Object.freeze({
  TOWN: 'Город', MAFIA: 'Мафия', MANIAC: 'Маньяк', NEUTRAL: 'Нейтрал',
});

const RoleID = Object.freeze({
  PEACEFUL:    'PEACEFUL',
  MAFIA:       'MAFIA',
  DON:         'DON',
  WEREWOLF:    'WEREWOLF',
  PROSTITUTE:  'PROSTITUTE',
  DOCTOR:      'DOCTOR',
  COMMISSIONER:'COMMISSIONER',
  MANIAC:      'MANIAC',
  BODYGUARD:   'BODYGUARD',
  HUNTER:      'HUNTER',
  VETERAN:     'VETERAN',
  JESTER:      'JESTER',
  EXECUTIONER: 'EXECUTIONER',
  WITCH:       'WITCH',
});

const ROLES = {
  [RoleID.PEACEFUL]: {
    id: RoleID.PEACEFUL, name: 'Мирный житель', emoji: '🤵', team: Team.TOWN,
    description: 'Обычный житель города. Участвует в голосовании днём.',
    nightAction: false, actionDescription: '', votes: 1,
  },
  [RoleID.MAFIA]: {
    id: RoleID.MAFIA, name: 'Мафия', emoji: '🎩', team: Team.MAFIA,
    description: 'Ночью голосует вместе с остальной мафией за устранение одного жителя.',
    nightAction: true, actionDescription: 'Выбери жертву для убийства.', votes: 1,
  },
  [RoleID.DON]: {
    id: RoleID.DON, name: 'Дон мафии', emoji: '👑', team: Team.MAFIA,
    description: 'Глава мафии. Ночью может вычислить Комиссара среди игроков.',
    nightAction: true, actionDescription: 'Выбери игрока — узнай, является ли он Комиссаром.', votes: 1,
  },
  [RoleID.WEREWOLF]: {
    id: RoleID.WEREWOLF, name: 'Оборотень', emoji: '🐺', team: Team.MAFIA,
    description: 'Воюет на стороне мафии, но выглядит как мирный при проверке комиссаром.',
    nightAction: true, actionDescription: 'Голосуй вместе с мафией за жертву.', votes: 1,
  },
  [RoleID.PROSTITUTE]: {
    id: RoleID.PROSTITUTE, name: 'Путана', emoji: '🍷', team: Team.TOWN,
    description: 'Ночью отвлекает одного игрока, блокируя его ночное действие.',
    nightAction: true, actionDescription: 'Выбери игрока, чьё ночное действие нужно заблокировать.', votes: 1,
  },
  [RoleID.DOCTOR]: {
    id: RoleID.DOCTOR, name: 'Доктор', emoji: '🩺', team: Team.TOWN,
    description: 'Ночью лечит одного игрока, спасая его от убийства.',
    nightAction: true, actionDescription: 'Выбери игрока для защиты этой ночью.', votes: 1,
  },
  [RoleID.COMMISSIONER]: {
    id: RoleID.COMMISSIONER, name: 'Комиссар', emoji: '🕵️', team: Team.TOWN,
    description: 'Ночью проверяет принадлежность игрока к мафии (оборотень выглядит мирным).',
    nightAction: true, actionDescription: 'Выбери игрока для проверки — мафия он или нет.', votes: 1,
  },
  [RoleID.MANIAC]: {
    id: RoleID.MANIAC, name: 'Маньяк', emoji: '🔪', team: Team.MANIAC,
    description: 'Действует в одиночку. Ночью убивает одного игрока. Победа — пережить всех.',
    nightAction: true, actionDescription: 'Выбери жертву для убийства.', votes: 1,
  },
  [RoleID.BODYGUARD]: {
    id: RoleID.BODYGUARD, name: 'Телохранитель', emoji: '🛡️', team: Team.TOWN,
    description: 'Ночью охраняет выбранного игрока. Если мафия атакует цель — телохранитель погибает вместо неё. Нельзя охранять себя.',
    nightAction: true, actionDescription: 'Выбери игрока для охраны этой ночью (не себя).', votes: 1,
  },
  [RoleID.HUNTER]: {
    id: RoleID.HUNTER, name: 'Охотник', emoji: '🏹', team: Team.TOWN,
    description: 'Пассивная роль. При гибели забирает с собой одного игрока по выбору ведущего.',
    nightAction: false, actionDescription: '', votes: 1,
  },
  [RoleID.VETERAN]: {
    id: RoleID.VETERAN, name: 'Ветеран', emoji: '🎖️', team: Team.TOWN,
    description: 'Может активировать боевую готовность 3 раза за игру. В ночь активации убивает всех, кто к нему пришёл.',
    nightAction: true, actionDescription: 'Выбери СЕБЯ чтобы активировать боевую готовность, или другого — чтобы пропустить ночь.', votes: 1,
  },
  [RoleID.JESTER]: {
    id: RoleID.JESTER, name: 'Шут', emoji: '🃏', team: Team.NEUTRAL,
    description: 'Нейтральная роль. Цель — быть казнённым голосованием. При казне голосованием — немедленная победа.',
    nightAction: false, actionDescription: '', votes: 1,
  },
  [RoleID.EXECUTIONER]: {
    id: RoleID.EXECUTIONER, name: 'Палач', emoji: '⚖️', team: Team.NEUTRAL,
    description: 'Ведущий тайно назначает цель (мирный житель). Добейся его казни. Если цель погибает ночью — становишься Шутом.',
    nightAction: false, actionDescription: '', votes: 1,
  },
  [RoleID.WITCH]: {
    id: RoleID.WITCH, name: 'Ведьма', emoji: '🧙', team: Team.NEUTRAL,
    description: 'Управляет ночным действием другого игрока. Нельзя контролировать одного 2 ночи подряд.',
    nightAction: true, actionDescription: 'Выбери игрока, чьё ночное действие хочешь контролировать.', votes: 1,
  },
};

function buildRoleList(playerCount, allowedRoles = null, mafiaCount = null) {
  if (playerCount < 8) throw new Error('Минимальное число игроков — 8.');
  let special = [];

  if (playerCount <= 9) {
    special = [RoleID.MAFIA, RoleID.MAFIA, RoleID.COMMISSIONER, RoleID.DOCTOR];
  } else if (playerCount <= 11) {
    special = [RoleID.DON, RoleID.MAFIA, RoleID.MAFIA, RoleID.COMMISSIONER, RoleID.DOCTOR];
  } else if (playerCount <= 13) {
    special = [RoleID.DON, RoleID.MAFIA, RoleID.MAFIA, RoleID.COMMISSIONER, RoleID.DOCTOR, RoleID.PROSTITUTE];
  } else if (playerCount <= 15) {
    special = [RoleID.DON, RoleID.MAFIA, RoleID.MAFIA, RoleID.COMMISSIONER, RoleID.DOCTOR, RoleID.PROSTITUTE, RoleID.MANIAC];
  } else if (playerCount <= 19) {
    special = [RoleID.DON, RoleID.MAFIA, RoleID.MAFIA, RoleID.MAFIA, RoleID.COMMISSIONER, RoleID.DOCTOR, RoleID.PROSTITUTE, RoleID.MANIAC];
  } else {
    special = [
      RoleID.DON, RoleID.MAFIA, RoleID.MAFIA, RoleID.MAFIA,
      RoleID.COMMISSIONER, RoleID.DOCTOR, RoleID.PROSTITUTE, RoleID.MANIAC,
      RoleID.BODYGUARD, RoleID.HUNTER, RoleID.VETERAN,
      RoleID.JESTER, RoleID.EXECUTIONER, RoleID.WITCH,
    ];
  }

  if (mafiaCount !== null && mafiaCount >= 1) {
    special = special.filter(id => id !== RoleID.MAFIA && id !== RoleID.DON);
    const includeDon = allowedRoles === null || allowedRoles.includes(RoleID.DON);
    if (includeDon) {
      if (mafiaCount === 1) {
        special.unshift(RoleID.DON);
      } else {
        special.unshift(...Array(mafiaCount - 1).fill(RoleID.MAFIA), RoleID.DON);
      }
    } else {
      special.unshift(...Array(mafiaCount).fill(RoleID.MAFIA));
    }
  }

  if (allowedRoles) {
    special = special.filter(id => id === RoleID.MAFIA || allowedRoles.includes(id));
  }

  const peacefulCount = playerCount - special.length;
  if (peacefulCount < 0) throw new Error(`Слишком мало мест для ${playerCount} игроков.`);
  return [...special, ...Array(peacefulCount).fill(RoleID.PEACEFUL)];
}

module.exports = { Team, RoleID, ROLES, buildRoleList };
