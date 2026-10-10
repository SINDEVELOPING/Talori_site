'use strict';

require('dotenv').config();
const ids = require('./ids');

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err?.message || err));
process.on('uncaughtException',  (err) => console.error('[uncaughtException]',  err?.message || err));

const express    = require('express');
const session    = require('express-session');
const mysql2     = require('mysql2/promise');
const axios      = require('axios');
const path       = require('path');
const fs         = require('fs');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const http       = require('http');
const { Server: SocketIO } = require('socket.io');
const { MafiaGame, GamePhase } = require('./game/gameManager.js');
const { ROLES, RoleID }        = require('./game/roles.js');
const { PokerGame, PokerPhase } = require('./game/poker.js');

const app        = express();
const httpServer = http.createServer(app);
const PORT       = process.env.PORT || 3000;

app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
}));

app.use(rateLimit({
    windowMs: 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Слишком много запросов, подождите.' },
}));

const authLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 10,
    message: { error: 'Слишком много попыток входа.' },
});
app.use('/auth', authLimit);

const apiLimit = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Слишком много запросов к API.' },
});
app.use('/api', apiLimit);

const proposeLimit = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3,
    message: { error: 'Подожди перед следующим запросом.' },
});
app.use('/api/mafia/propose', proposeLimit);
app.use('/api/poker/propose', proposeLimit);

const mafiaSessions = new Map();

const MAFIA_BOT_SECRET = process.env.MAFIA_BOT_SECRET || '';
const WEBSITE_URL      = process.env.WEBSITE_URL || `http://localhost:${PORT}`;

const DISCORD_CLIENT_ID     = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI  = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const GUILD_ID              = ids.guild;

const SERVER_INVITE     = process.env.SERVER_INVITE     || 'https://discord.gg/talori';
const VERIFY_CHANNEL_ID = process.env.VERIFY_CHANNEL_ID || '';
const BAN_APPEAL_CHANNEL_ID         = process.env.BAN_APPEAL_CHANNEL_ID || ids.channels.banAppeal;
const NONADMISSION_APPEAL_CHANNEL_ID = process.env.NONADMISSION_APPEAL_CHANNEL_ID || ids.channels.nonadmissionAppeal;

const PUNISHMENT_ROLES = {
    [ids.punish.ban]: { type: 'ban',            label: 'Бан',              color: '#e05555', blocking: true  },
    [ids.punish.unverify]: { type: 'unverify',       label: 'Анверефи',         color: '#8b5fe8', blocking: true  },
    [ids.punish.nonadmission]: { type: 'nonadmission',   label: 'Недопуск',         color: '#e8a03b', blocking: true  },
    [ids.punish.nonadmissionBan]: { type: 'nonadmissionBan',label: 'Бан-недопуск',     color: '#e05555', blocking: true  },
    [ids.punish.voicemute]: { type: 'voicemute',      label: 'Голосовой мут',    color: '#5b7de8', blocking: false },
    [ids.punish.textmute]: { type: 'textmute',       label: 'Текстовый мут',    color: '#5b7de8', blocking: false },
    [ids.punish.chillban]: { type: 'chillban',       label: 'Чилл бан',         color: '#3ab8b8', blocking: false },
    [ids.punish.eventsBan]: { type: 'events_ban',     label: 'Бан с ивентов',    color: '#c8a84b', blocking: false },
    [ids.punish.creativeBan]: { type: 'creative_ban',   label: 'Бан с креатива',   color: '#c8a84b', blocking: false },
    [ids.punish.closeBan]: { type: 'close_ban',      label: 'Бан с клозов',     color: '#c8a84b', blocking: false },
    [ids.punish.mafiaBan]: { type: 'mafia_ban',      label: 'Бан с мафии',      color: '#c8a84b', blocking: false },
};

const STAFF_ROLE_BRANCH = {
    [ids.staff.helper]: 'helper',
    [ids.staff.eventsmod]: 'eventsmod',
    [ids.staff.closemod]: 'closemod',
    [ids.staff.tribunemod]: 'tribunemod',
    [ids.staff.creative]: 'creative',
    [ids.staff.contentmaker]: 'contentmaker',
    [ids.staff.mod]: 'mod',
    [ids.staff.sup]: 'sup',
    [ids.staff.clanmod]: 'clanmod',
    [ids.staff.mafiamod]: 'mafiamod',
};

const BRANCH_LEAD_ROLE = {
    [ids.leads.staff]: ['*'],
    [ids.leads.mod]: ['mod'],
    [ids.leads.sup]: ['sup'],
    [ids.leads.creative]: ['creative'],
    [ids.leads.helper]: ['helper'],
    [ids.leads.tribunemod]: ['tribunemod'],
    [ids.leads.eventsmod]: ['eventsmod'],
    [ids.leads.mafiamod]: ['mafiamod'],
    [ids.leads.closemod]: ['closemod'],
    [ids.leads.clanmod]: ['clanmod'],
    [ids.leads.contentmaker]: ['contentmaker'],
};

const ADMIN_ROLES = new Set([
    ids.leads.staff,
]);

const TIER_ROLES = new Set([
    ids.tiers.administrator,
    ids.tiers.assistance,
    ids.tiers.curator,
    ids.tiers.master,
]);

const OWNER_IDS = new Set(ids.owners);

const HOST_ROLE_ID = ids.hostRole;

const STAFF_ROLE_NAMES = {
    [ids.staff.helper]: 'Хелпер',
    [ids.staff.eventsmod]: 'Ивент мод',
    [ids.staff.closemod]: 'Клоуз мод',
    [ids.staff.tribunemod]: 'Трибун мод',
    [ids.staff.creative]: 'Креатив',
    [ids.staff.contentmaker]: 'Контентмейкер',
    [ids.staff.mod]: 'Модератор',
    [ids.staff.sup]: 'Саппорт',
    [ids.staff.clanmod]: 'Клан мод',
    [ids.staff.mafiamod]: 'Мафия мод',
    [ids.tiers.administrator]: 'Администратор',
    [ids.tiers.assistance]: 'Заместитель',
    [ids.tiers.curator]: 'Куратор',
    [ids.tiers.master]: 'Мастер',
    [ids.leads.staff]: 'Отвечаю за Staff',
    [ids.leads.mod]: 'Куратор Mod',
    [ids.leads.sup]: 'Куратор Support',
    [ids.leads.creative]: 'Куратор Creative',
    [ids.leads.helper]: 'Куратор Helper',
    [ids.leads.tribunemod]: 'Куратор Tribune',
    [ids.leads.eventsmod]: 'Куратор Events',
    [ids.leads.mafiamod]: 'Куратор Mafia',
    [ids.leads.closemod]: 'Куратор Closes',
    [ids.leads.clanmod]: 'Куратор Clans',
    [ids.leads.contentmaker]: 'Куратор Content',
};

const POSITION_ROLE_PRIORITY = [
    { id: ids.positions.owner, name: 'Owner' },
    { id: ids.positions.bless, name: 'Bless' },
    { id: ids.positions.global, name: 'Global' },
    { id: ids.positions.staffAdministrator, name: 'Staff Administrator' },
];

const STAFF_TIER_ROLES = {
    [ids.leads.staff]: 'Главный по стаффу',
    [ids.tiers.administrator]: 'Администратор',
    [ids.tiers.assistance]: 'Заместитель',
    [ids.tiers.curator]: 'Куратор',
    [ids.tiers.master]: 'Мастер',
};
const STAFF_TIER_PRIORITY = [
    ids.leads.staff,
    ids.tiers.administrator,
    ids.tiers.assistance,
    ids.tiers.curator,
    ids.tiers.master,
];

const BRANCH_LEAD_BRANCH = {
    [ids.leads.mod]: 'mod',
    [ids.leads.sup]: 'sup',
    [ids.leads.creative]: 'creative',
    [ids.leads.helper]: 'helper',
    [ids.leads.tribunemod]: 'tribunemod',
    [ids.leads.eventsmod]: 'eventsmod',
    [ids.leads.mafiamod]: 'mafiamod',
    [ids.leads.closemod]: 'closemod',
    [ids.leads.clanmod]: 'clanmod',
    [ids.leads.contentmaker]: 'contentmaker',
};

const BRANCH_DISPLAY_LABEL = {
    helper:       'Хелпер',
    eventsmod:    'Ивент мод',
    closemod:     'Клоуз мод',
    tribunemod:   'Трибун мод',
    creative:     'Креатив',
    contentmaker: 'Контент',
    mod:          'Модератор',
    sup:          'Саппорт',
    clanmod:      'Клан мод',
    mafiamod:     'Мафия мод',
};

function getAccess(memberRoleIds, userId) {
    const roles = new Set(memberRoleIds);

    if (OWNER_IDS.has(userId)) return { level: 'admin', branches: ['*'] };

    const leadBranches = new Set();
    for (const id of roles) {
        if (BRANCH_LEAD_ROLE[id]) {
            BRANCH_LEAD_ROLE[id].forEach(b => leadBranches.add(b));
        }
    }
    if (leadBranches.size) {
        if (leadBranches.has('*')) return { level: 'admin', branches: ['*'] };
        return { level: 'lead', branches: [...leadBranches] };
    }

    for (const id of roles) {
        if (ADMIN_ROLES.has(id)) return { level: 'admin', branches: ['*'] };
    }

    for (const id of roles) {
        if (STAFF_ROLE_BRANCH[id]) {
            return { level: 'staff', branches: [STAFF_ROLE_BRANCH[id]], ownOnly: true };
        }
    }

    return { level: 'none', branches: [] };
}

function pool(database, limit = 5) {
    return mysql2.createPool({
        host: '127.0.0.1', user: 'root',
        password: process.env.DB_PASS || '',
        database, waitForConnections: true, connectionLimit: limit,
    });
}
const db         = pool('modbot', 10);
const dbEco      = pool('eco');
const dbEconomy  = pool('economy');
const dbClans    = pool('clans');
const dbGiveaway = pool('giveaway');
const dbApps     = pool('apps');

const BOT_TOKEN = process.env.BOT_TOKEN;
const discordBot = axios.create({
    baseURL: 'https://discord.com/api/v10',
    headers: { Authorization: `Bot ${BOT_TOKEN}` },
});

const GUILD_BOT_TOKEN = process.env.GUILD_BOT_TOKEN;
const guildBot = GUILD_BOT_TOKEN
    ? axios.create({ baseURL: 'https://discord.com/api/v10', headers: { Authorization: `Bot ${GUILD_BOT_TOKEN}` } })
    : null;

const userCache = new Map();
async function getUser(userId) {
    if (userCache.has(userId)) return userCache.get(userId);
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const { data: d } = await discordBot.get(`/users/${userId}`);
            const u = { id: d.id, username: d.global_name || d.username, avatar: d.avatar };
            userCache.set(userId, u);
            return u;
        } catch (err) {
            const retry = err?.response?.headers?.['x-ratelimit-reset-after'];
            if (err?.response?.status === 429 && retry && attempt < 2) {
                await new Promise(r => setTimeout(r, parseFloat(retry) * 1000 + 100));
                continue;
            }
            break;
        }
    }
    return { id: userId, username: 'Пользователь', avatar: null };
}

const MySQLStore = require('express-mysql-session')(session);
const sessionStore = new MySQLStore({
    host: '127.0.0.1', user: 'root',
    password: process.env.DB_PASS || '',
    database: 'modbot',
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 30 * 24 * 60 * 60 * 1000,
    createDatabaseTable: true,
    schema: { tableName: 'site_sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
});
if (typeof sessionStore.on === 'function') sessionStore.on('error', (e) => console.error('[session store]', e?.message || e));

const sessionMiddleware = session({
    secret:            process.env.SESSION_SECRET || 'talori_secret_change_me',
    resave:            false,
    saveUninitialized: false,
    store:             sessionStore,
    cookie:            { maxAge: 30 * 24 * 60 * 60 * 1000 },
});
app.use(sessionMiddleware);

app.use(express.json());

app.use((req, res, next) => {
    const p = req.path.toLowerCase();
    const blocked =
        p.startsWith('/.') ||
        p.includes('.env') ||
        p.startsWith('/game/') ||
        p.startsWith('/logs/') ||
        p.startsWith('/node_modules/') ||
        (p.startsWith('/server') && p.endsWith('.js')) ||
        (p.startsWith('/package') && p.endsWith('.json')) ||
        p === '/ecosystem.config.js' ||
        p === '/deploy.sh' ||
        p.endsWith('.md');
    if (blocked) return res.status(404).end();
    next();
});

app.use(express.static(path.join(__dirname)));

app.get('/auth/login', (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify+guilds.members.read`;
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const code = req.query.code;
    if (!code) return res.redirect('/?error=no_code');

    try {
        const tokenRes = await axios.post('https://discord.com/api/oauth2/token',
            new URLSearchParams({
                client_id:     DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type:    'authorization_code',
                code,
                redirect_uri:  DISCORD_REDIRECT_URI,
            }),
            { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
        );
        const { access_token, token_type } = tokenRes.data;

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `${token_type} ${access_token}` },
        });
        const user = userRes.data;

        let memberRes = await axios.get(
            `https://discord.com/api/users/@me/guilds/${GUILD_ID}/member`,
            { headers: { Authorization: `${token_type} ${access_token}` } }
        ).catch(() => null);

        if (!memberRes && guildBot) {
            memberRes = await guildBot.get(`/guilds/${GUILD_ID}/members/${user.id}`).catch(() => null);
        }

        const inGuild        = !!memberRes;
        const memberRoles    = memberRes?.data?.roles ?? [];
        const joinedAt       = memberRes?.data?.joined_at ?? null;
        const serverNick     = memberRes?.data?.nick ?? null;
        const access         = getAccess(memberRoles, user.id);

        const punishments = OWNER_IDS.has(user.id) ? [] : memberRoles
            .filter(r => PUNISHMENT_ROLES[r])
            .map(r => PUNISHMENT_ROLES[r]);

        req.session.user = {
            id:            user.id,
            username:      user.global_name || user.username,
            discriminator: user.discriminator,
            avatar:        user.avatar,
            banner:        user.banner || null,
            access,
            memberRoles,
            joinedAt,
            serverNick,
            inGuild,
            punishments,
        };

        res.redirect('/events.html');
    } catch (err) {
        console.error('OAuth error:', err.response?.data ?? err.message);
        res.redirect('/?error=oauth_failed');
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

function requireAuth(req, res, next) {
    if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
    next();
}

const ROLE_KEY_MAP = {
    PEACEFUL: 'mir', MAFIA: 'maf', COMMISSIONER: 'kom', DOCTOR: 'doc',
    DON: 'don', PROSTITUTE: 'put', JESTER: 'shu', MANIAC: 'man',
    WITCH: 'ved', BODYGUARD: 'tel', WEREWOLF: 'wer', VETERAN: 'vet',
    HUNTER: 'hun', EXECUTIONER: 'exe',
};

function loadMafiaPlayerStats() {
    try {
        const p = path.join(__dirname, '..', 'Mafia', 'data', 'player_stats.json');
        return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch { return {}; }
}

async function buildProfile(userId, discord, memberRoleIds) {
    const uid   = String(userId);
    const roles = new Set(memberRoleIds || []);

    const access   = memberRoleIds ? getAccess(memberRoleIds, uid) : { level: 'none', branches: [] };
    const isAdmin  = access.level === 'admin' || [...roles].some(r => TIER_ROLES.has(r));
    const isMod    = roles.has(ids.staff.mod);
    const isStaff  = isAdmin || Object.keys(STAFF_ROLE_BRANCH).some(r => roles.has(r)) || POSITION_ROLE_PRIORITY.some(r => roles.has(r.id));

    const positionMatch = POSITION_ROLE_PRIORITY.find(r => roles.has(r.id));
    const position = isStaff ? (positionMatch ? positionMatch.name : 'Без должности') : null;

    let staffRole = null;
    if (isStaff) {
        const tierRoleId  = STAFF_TIER_PRIORITY.find(rid => roles.has(rid));
        const tierName    = tierRoleId ? STAFF_TIER_ROLES[tierRoleId] : null;
        const branchKey   = Object.entries(STAFF_ROLE_BRANCH).find(([rid]) => roles.has(rid))?.[1]
                         || Object.entries(BRANCH_LEAD_BRANCH).find(([rid]) => roles.has(rid))?.[1]
                         || null;
        const branchLabel = branchKey ? BRANCH_DISPLAY_LABEL[branchKey] : null;
        if (tierName && branchLabel) staffRole = `${tierName} по ${branchLabel}`;
        else if (tierName)           staffRole = tierName;
        else if (branchLabel)        staffRole = branchLabel;
        else                         staffRole = 'Стафф';
    }

    const [econRow, ecoRow, clanRow, staffRow] = await Promise.all([
        dbEconomy.query(
            'SELECT balance, xp, level, voiceTime, messageCount FROM users WHERE userId = ?', [uid]
        ).then(([[r]]) => r || null).catch(() => null),
        dbEco.query(
            'SELECT balance, reputation FROM users WHERE memberId = ?', [uid]
        ).then(([[r]]) => r || null).catch(() => null),
        dbClans.query(`
            SELECT cm.role, c.id AS clanId, c.clanName, c.clanColor,
                   c.clanLogo, c.clanRating, c.clanLevel
            FROM clan_members cm JOIN clans c ON cm.clanId = c.id
            WHERE cm.userId = ? LIMIT 1
        `, [uid]).then(([[r]]) => r || null).catch(() => null),
        isStaff
            ? db.query('SELECT voiceTimeAllTime FROM staff WHERE memberId = ?', [uid])
                .then(([[r]]) => r || null).catch(() => null)
            : Promise.resolve(null),
    ]);

    const level      = econRow?.level || 0;
    const exp        = Number(econRow?.xp || 0);
    const nextLevelExp = level * 500 + 500;
    const voiceMs    = Number(econRow?.voiceTime || 0) * 1000;
    const messages   = econRow?.messageCount || 0;
    const balance    = Number(econRow?.balance || 0);
    const reputation = Number(ecoRow?.reputation || 0);

    const [rankOverall, rankVoice, rankMessages, rankEco] = await Promise.all([
        dbEconomy.query('SELECT COUNT(*) AS cnt FROM users WHERE xp > ?', [exp])
            .then(([[r]]) => (Number(r?.cnt) || 0) + 1).catch(() => null),
        dbEconomy.query('SELECT COUNT(*) AS cnt FROM users WHERE voiceTime > ?', [Number(econRow?.voiceTime || 0)])
            .then(([[r]]) => (Number(r?.cnt) || 0) + 1).catch(() => null),
        dbEconomy.query('SELECT COUNT(*) AS cnt FROM users WHERE messageCount > ?', [messages])
            .then(([[r]]) => (Number(r?.cnt) || 0) + 1).catch(() => null),
        dbEconomy.query('SELECT COUNT(*) AS cnt FROM users WHERE balance > ?', [balance])
            .then(([[r]]) => (Number(r?.cnt) || 0) + 1).catch(() => null),
    ]);

    const mafiaAll  = loadMafiaPlayerStats();
    const mafiaRaw  = mafiaAll[uid] || null;
    let mafiaStats  = { games: 0, wins: 0, roles: {} };
    let rankMafia   = null;
    if (mafiaRaw) {
        const mappedRoles = {};
        for (const [roleId, st] of Object.entries(mafiaRaw.roles || {})) {
            const key = ROLE_KEY_MAP[roleId];
            if (key) mappedRoles[key] = st;
        }
        mafiaStats = { games: mafiaRaw.games || 0, wins: mafiaRaw.wins || 0, roles: mappedRoles };
        if (mafiaRaw.games >= 5) {
            const sorted = Object.entries(mafiaAll)
                .filter(([, s]) => s.games >= 5)
                .sort((a, b) => (b[1].wins / b[1].games) - (a[1].wins / a[1].games));
            const idx = sorted.findIndex(([id]) => id === uid);
            if (idx >= 0) rankMafia = idx + 1;
        }
    }

    let rankClan = null;
    if (clanRow) {
        try {
            const [[cr]] = await dbClans.query(
                'SELECT COUNT(*) AS cnt FROM clans WHERE clanRating > ?', [clanRow.clanRating || 0]
            );
            rankClan = (Number(cr?.cnt) || 0) + 1;
        } catch {}
    }

    let staffStats = null;
    if (isStaff && staffRow) {
        staffStats = {
            voiceMs: Number(staffRow.voiceTimeAllTime || 0) * 1000,
        };
    }

    const clan = clanRow ? {
        id:         String(clanRow.clanId),
        clanName:   clanRow.clanName,
        clanColor:  clanRow.clanColor,
        clanLevel:  clanRow.clanLevel,
        clanRating: clanRow.clanRating,
        clanLogo:   clanRow.clanLogo || null,
        role:       clanRow.role,
    } : null;

    return {
        id: uid,
        username: discord.username,
        avatar:   discord.avatar   || null,
        banner:   discord.banner   || null,
        level,
        exp,
        nextLevelExp,
        rank:        rankOverall,
        reputation,
        balance,
        isStaff,
        isAdmin,
        isMod,
        staffRole,
        position,
        ...(staffStats ? { staffStats } : {}),
        ranks: {
            mafia:    rankMafia,
            voice:    rankVoice,
            messages: rankMessages,
            eco:      rankEco,
            clan:     rankClan,
        },
        stats: {
            messages,
            voiceMs,
            mafia: mafiaStats,
        },
        clan,
    };
}

app.get('/api/me', requireAuth, async (req, res) => {
    const {
        id, username, avatar, banner, access, joinedAt,
        serverNick, discriminator, inGuild, punishments, memberRoles,
    } = req.session.user;

    const roles  = new Set(memberRoles || []);
    const isHost = roles.has(HOST_ROLE_ID) || OWNER_IDS.has(id);

    let bannerHash = banner || null;
    if (!bannerHash) {
        try {
            const { data: u } = await discordBot.get(`/users/${id}`);
            bannerHash = u.banner || null;
            req.session.user.banner = bannerHash;
        } catch {}
    }

    try {
        const profile = await buildProfile(
            id,
            { username, avatar, banner: bannerHash },
            memberRoles,
        );
        res.json({
            ...profile,
            access, joinedAt, serverNick, discriminator,
            inGuild:     inGuild     ?? false,
            punishments: punishments ?? [],
            isHost,
            memberRoles: memberRoles || [],
        });
    } catch (err) {
        console.error('[/api/me]', err.message);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/api/config', (req, res) => {
    res.json({
        guildId:       GUILD_ID,
        serverInvite:  SERVER_INVITE,
        verifyChannel: VERIFY_CHANNEL_ID,
        verifyUrl:     VERIFY_CHANNEL_ID ? `https://discord.com/channels/${GUILD_ID}/${VERIFY_CHANNEL_ID}` : SERVER_INVITE,
        banAppealUrl:          `https://discord.com/channels/${GUILD_ID}/${BAN_APPEAL_CHANNEL_ID}`,
        nonadmissionAppealUrl: `https://discord.com/channels/${GUILD_ID}/${NONADMISSION_APPEAL_CHANNEL_ID}`,
    });
});

app.get('/api/staff', requireAuth, async (req, res) => {
    const { access, id: userId } = req.session.user;

    if (access.level === 'none') {
        return res.status(403).json({ error: 'Forbidden' });
    }

    try {
        let rows;

        if (access.level === 'admin' || access.branches.includes('*')) {
            [rows] = await db.query('SELECT * FROM staff ORDER BY warnsAll + mutesAll + bansAll + verifiesAll DESC');
        } else if (access.level === 'lead') {
            const placeholders = access.branches.map(() => '?').join(',');
            [rows] = await db.query(
                `SELECT * FROM staff WHERE type IN (${placeholders}) ORDER BY warnsAll + mutesAll + bansAll + verifiesAll DESC`,
                access.branches
            );
        } else {
            [rows] = await db.query('SELECT * FROM staff WHERE memberId = ?', [userId]);
        }

        const parsed = rows.map(r => ({
            ...r,
            messagesWeek:       safeJSON(r.messagesWeek,      [0,0,0,0,0,0,0]),
            voiceTimeWeek:      safeJSON(r.voiceTimeWeek,     [0,0,0,0,0,0,0]),
            warnsWeek:          safeJSON(r.warnsWeek,         [0,0,0,0,0,0,0]),
            mutesWeek:          safeJSON(r.mutesWeek,         [0,0,0,0,0,0,0]),
            bansWeek:           safeJSON(r.bansWeek,          [0,0,0,0,0,0,0]),
            reportsWeek:        safeJSON(r.reportsWeek,       [0,0,0,0,0,0,0]),
            verifiesWeek:       safeJSON(r.verifiesWeek,      [0,0,0,0,0,0,0]),
            nonAdmissionsWeek:  safeJSON(r.nonAdmissionsWeek, [0,0,0,0,0,0,0]),
            verifiesMonth:      safeJSON(r.verifiesMonth,     []),
        }));

        if (guildBot) {
            await Promise.all(parsed.map(async (m) => {
                try {
                    const { data: member } = await guildBot.get(`/guilds/${GUILD_ID}/members/${m.memberId}`);
                    m.username   = member.nick || member.user?.global_name || member.user?.username || m.memberId;
                    m.avatarHash = member.user?.avatar || null;
                    m.avatarId   = member.user?.id || m.memberId;
                    const rolesSet = new Set(member.roles || []);
                    const topTier  = STAFF_TIER_PRIORITY.find(rid => rolesSet.has(rid));
                    m.tierRole   = topTier ? STAFF_TIER_ROLES[topTier] : null;
                } catch {
                    m.username   = m.memberId;
                    m.avatarHash = null;
                    m.avatarId   = m.memberId;
                    m.tierRole   = null;
                }
            }));
        }

        let extraMembers = [];
        if (guildBot && (access.level === 'admin' || access.branches.includes('*'))) {
            try {
                const EXTRA_ROLES = {
                    [ids.tiers.master]: 'master',
                    [ids.tiers.curator]: 'curator',
                    [ids.tiers.assistance]: 'assistance',
                    [ids.tiers.administrator]: 'administrator',
                };
                const trackedIds = new Set(parsed.map(m => m.memberId));
                const { data: allMembers } = await guildBot.get(
                    `/guilds/${GUILD_ID}/members?limit=1000`
                );
                for (const member of allMembers) {
                    if (trackedIds.has(member.user?.id)) continue;
                    let roleType = null;
                    for (const rid of member.roles) {
                        if (EXTRA_ROLES[rid]) { roleType = EXTRA_ROLES[rid]; break; }
                    }
                    if (!roleType) continue;
                    extraMembers.push({
                        memberId:  member.user.id,
                        type:      roleType,
                        username:  member.nick || member.user?.global_name || member.user?.username || member.user.id,
                        avatarHash: member.user?.avatar || null,
                        avatarId:  member.user.id,
                        warnsAll: 0, mutesAll: 0, bansAll: 0, verifiesAll: 0, reportsAll: 0,
                        warnsWeek: [0,0,0,0,0,0,0], mutesWeek: [0,0,0,0,0,0,0],
                        bansWeek: [0,0,0,0,0,0,0], verifiesWeek: [0,0,0,0,0,0,0],
                        reportsWeek: [0,0,0,0,0,0,0], nonAdmissionsWeek: [0,0,0,0,0,0,0],
                        messagesWeek: [0,0,0,0,0,0,0], voiceTimeAllTime: 0,
                    });
                }
            } catch(e) {
                console.error('[staff] extraMembers fetch error:', e.message);
            }
        }

        res.json({ access, members: [...parsed, ...extraMembers] });
    } catch (err) {
        console.error('DB error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/staff/overview', requireAuth, async (req, res) => {
    const { access } = req.session.user;
    if (access.level === 'none') return res.status(403).json({ error: 'Forbidden' });

    try {
        let whereClause = '';
        let params      = [];

        if (access.level === 'staff') {
            whereClause = 'WHERE memberId = ?';
            params      = [req.session.user.id];
        } else if (access.level === 'lead' && !access.branches.includes('*')) {
            const ph    = access.branches.map(() => '?').join(',');
            whereClause = `WHERE type IN (${ph})`;
            params      = access.branches;
        }

        const [[totals]] = await db.query(`
            SELECT
                COUNT(*)                    AS memberCount,
                SUM(verifiesAll)            AS verifiesAll,
                SUM(warnsAll)               AS warnsAll,
                SUM(mutesAll)               AS mutesAll,
                SUM(bansAll)                AS bansAll,
                SUM(reportsAll)             AS reportsAll,
                SUM(nonAdmissionsAll)       AS nonAdmissionsAll
            FROM staff ${whereClause}
        `, params);

        res.json(totals);
    } catch (err) {
        console.error('Overview error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/staff/top', requireAuth, async (req, res) => {
    const { access, id: userId } = req.session.user;
    if (access.level === 'none') return res.status(403).json({ error: 'Forbidden' });

    try {
        let whereClause = '';
        let params      = [];

        if (access.level === 'staff') {
            whereClause = 'WHERE memberId = ?';
            params      = [userId];
        } else if (access.level === 'lead' && !access.branches.includes('*')) {
            const ph    = access.branches.map(() => '?').join(',');
            whereClause = `WHERE type IN (${ph})`;
            params      = access.branches;
        }

        const [rows] = await db.query(`
            SELECT memberId, type,
                   verifiesAll, reportsAll, warnsAll, mutesAll, bansAll,
                   voiceTimeAllTime,
                   JSON_EXTRACT(verifiesWeek,'$') AS verifiesWeekRaw
            FROM staff ${whereClause}
            ORDER BY verifiesAll DESC
            LIMIT 10
        `, params);

        res.json(rows.map(r => ({
            ...r,
            verifiesWeek: safeJSON(r.verifiesWeekRaw, [0,0,0,0,0,0,0]),
        })));
    } catch (err) {
        console.error('Top error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/stats', async (req, res) => {
    try {
        const [guildRes, [[clans]], [[giveaways]]] = await Promise.all([
            discordBot.get(`/guilds/${GUILD_ID}?with_counts=true`).catch(() => null),
            dbClans.query('SELECT COUNT(*) AS cnt FROM clans').catch(() => [[{ cnt: 0 }]]),
            dbGiveaway.query('SELECT COUNT(*) AS cnt FROM giveaways').catch(() => [[{ cnt: 0 }]]),
        ]);
        let mafiaGames = 0;
        try {
            const p = path.join(__dirname, '..', 'Mafia', 'src', 'data', 'stats.json');
            const s = JSON.parse(fs.readFileSync(p, 'utf8'));
            mafiaGames = s[GUILD_ID]?.totalGames || 0;
        } catch {}
        res.json({
            members:    guildRes?.data?.approximate_member_count || 0,
            mafiaGames,
            clans:      clans?.cnt || 0,
            giveaways:  giveaways?.cnt || 0,
        });
    } catch (err) {
        res.json({ members: 0, mafiaGames: 0, clans: 0, giveaways: 0 });
    }
});

const discordCache = new Map();
async function cachedDiscord(key, fn, ttl = 30000) {
    const cached = discordCache.get(key);
    if (cached && Date.now() - cached.ts < ttl) return cached.data;
    const data = await fn();
    discordCache.set(key, { data, ts: Date.now() });
    return data;
}

app.get('/api/pulse', async (req, res) => {
    try {
        const [widgetRes, eventsRes, [[ecoCount]]] = await Promise.all([
            cachedDiscord('widget', () => axios.get(`https://discord.com/api/v10/guilds/${GUILD_ID}/widget.json`).catch(() => null)),
            cachedDiscord('events', () => discordBot.get(`/guilds/${GUILD_ID}/scheduled-events?with_user_count=true`).catch(() => null)),
            dbEco.query('SELECT COUNT(*) AS cnt FROM users').catch(() => [[{ cnt: 0 }]]),
        ]);

        const online = widgetRes?.data?.presence_count || 0;
        const total  = ecoCount?.cnt || 0;

        const mafiaTables = [...mafiaSessions.values()].filter(s => !s.isSolo);
        const mafiaTable  = mafiaTables.length > 0
            ? { seats: mafiaTables[0].game.players.size, maxSeats: 10, phase: mafiaTables[0].game.phase }
            : null;

        const allEvents    = eventsRes?.data || [];
        const activeEvs    = allEvents.filter(e => e.status === 2);
        const scheduledEvs = allEvents.filter(e => e.status === 1);
        const activeMatch  = activeEvs[0]?.name || scheduledEvs[0]?.name || null;

        const [recentGW] = await dbGiveaway.query(
            `SELECT name, expired FROM giveaways ORDER BY id DESC LIMIT 3`
        ).catch(() => [[]]);

        const [recentClans] = await dbClans.query(
            `SELECT clanName, clanLevel FROM clans ORDER BY id DESC LIMIT 3`
        ).catch(() => [[]]);

        const feed = [];
        const now  = Date.now();

        for (const t of mafiaTables.slice(0, 2)) {
            feed.push({ dot: 'red', text: t.game.phase === 'WAITING' ? 'Открыт стол мафии' : 'Идёт игра в мафию', meta: `· ${t.game.players.size}/10`, ts: now });
        }
        for (const e of activeEvs.slice(0, 2)) {
            feed.push({ dot: 'blue', text: e.name, meta: `· ${e.user_count || 0} участников`, ts: new Date(e.scheduled_start_time).getTime() });
        }
        for (const e of scheduledEvs.slice(0, 1)) {
            feed.push({ dot: 'blue', text: e.name, meta: `· скоро`, ts: new Date(e.scheduled_start_time).getTime() });
        }
        for (const g of recentGW.slice(0, 2)) {
            feed.push({ dot: 'gold', text: g.name || 'Розыгрыш', meta: '', ts: Number(g.expired) });
        }
        for (const c of recentClans.slice(0, 1)) {
            feed.push({ dot: 'green', text: `Клан «${c.clanName}»`, meta: `· lvl ${c.clanLevel || 1}`, ts: now - 60000 });
        }

        feed.sort((a, b) => b.ts - a.ts);
        feed.splice(5);

        const pad = n => String(n).padStart(2, '0');
        const fmt = ts => { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

        res.json({
            online, total,
            mafiaTable,
            activeMatch,
            feed: feed.map(f => ({ dot: f.dot, text: f.text, meta: f.meta, time: fmt(f.ts) })),
        });
    } catch (err) {
        console.error('Pulse error:', err.message);
        res.json({ online: 0, total: 0, mafiaTable: null, activeMatch: null, feed: [] });
    }
});

app.get('/api/events', async (req, res) => {
    try {
        const resp = await cachedDiscord('events', () =>
            discordBot.get(`/guilds/${GUILD_ID}/scheduled-events?with_user_count=true`).catch(() => null)
        );
        const data = resp?.data || [];
        res.json({
            active:    data.filter(e => e.status === 2),
            scheduled: data.filter(e => e.status === 1),
        });
    } catch (err) {
        console.error('Events error:', err.response?.data ?? err.message);
        res.json({ active: [], scheduled: [] });
    }
});

app.get('/api/giveaways', async (req, res) => {
    try {
        const now = Date.now();
        const [active] = await dbGiveaway.query(
            `SELECT * FROM giveaways WHERE expired > ? AND JSON_LENGTH(winners) = 0 ORDER BY expired ASC`,
            [now]
        );
        const [past] = await dbGiveaway.query(
            `SELECT * FROM giveaways WHERE expired <= ? OR JSON_LENGTH(winners) > 0 ORDER BY expired DESC LIMIT 15`,
            [now]
        );
        const parse = g => ({ ...g, members: safeJSON(g.members, []), winners: safeJSON(g.winners, []), servers: safeJSON(g.servers, []) });
        res.json({ active: active.map(parse), past: past.map(parse) });
    } catch (err) {
        console.error('Giveaways error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/leaderboard', async (req, res) => {
    const tab = req.query.tab || 'general';
    try {
        if (tab === 'general') {
            const [rows] = await dbEconomy.query(
                'SELECT userId, balance, xp AS exp, voiceTime, messageCount AS messages FROM users ORDER BY xp DESC LIMIT 25'
            );
            const enriched = await Promise.all(rows.map(async (r, i) => ({
                rank: i + 1, ...r, ...await getUser(r.userId),
            })));
            return res.json(enriched);
        }
        if (tab === 'eco') {
            const [rows] = await dbEconomy.query(
                'SELECT userId, balance, xp AS exp, voiceTime, messageCount AS messages FROM users ORDER BY balance DESC LIMIT 25'
            );
            const enriched = await Promise.all(rows.map(async (r, i) => ({
                rank: i + 1, ...r, ...await getUser(r.userId),
            })));
            return res.json(enriched);
        }
        if (tab === 'clans') {
            const [rows] = await dbClans.query(`
                SELECT c.id, c.clanName, c.clanColor, c.clanLogo, c.clanRating, c.clanLevel,
                       c.totalVoiceTime, c.totalMessages, c.clanBalance, c.ownerId, c.maxMembers,
                       COUNT(m.id) AS memberCount
                FROM clans c LEFT JOIN clan_members m ON c.id = m.clanId
                GROUP BY c.id ORDER BY c.clanRating DESC LIMIT 25
            `);
            const enriched = await Promise.all(rows.map(async (r, i) => ({
                rank: i + 1, ...r, owner: await getUser(r.ownerId),
            })));
            return res.json(enriched);
        }
        if (tab === 'mafia') {
            const statsPath = path.join(__dirname, '..', 'Mafia', 'src', 'data', 'stats.json');
            let stats = {};
            try { stats = JSON.parse(fs.readFileSync(statsPath, 'utf8')); } catch {}
            return res.json(stats[GUILD_ID] ?? { totalGames: 0, townWins: 0, mafiaWins: 0, maniacWins: 0, jesterWins: 0, executionerWins: 0 });
        }
        if (tab === 'voice') {
            const [rows] = await dbEconomy.query(
                'SELECT userId, voiceTime, xp AS exp, messageCount AS messages FROM users WHERE voiceTime > 0 ORDER BY voiceTime DESC LIMIT 25'
            );
            const enriched = await Promise.all(rows.map(async (r, i) => ({
                rank: i + 1, ...r, ...await getUser(r.userId),
            })));
            return res.json(enriched);
        }
        if (tab === 'messages') {
            const [rows] = await dbEconomy.query(
                'SELECT userId, messageCount AS messages, xp AS exp, voiceTime FROM users WHERE messageCount > 0 ORDER BY messageCount DESC LIMIT 25'
            );
            const enriched = await Promise.all(rows.map(async (r, i) => ({
                rank: i + 1, ...r, ...await getUser(r.userId),
            })));
            return res.json(enriched);
        }
        res.json([]);
    } catch (err) {
        console.error('Leaderboard error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/clan/:id', requireAuth, async (req, res) => {
    const clanId = parseInt(req.params.id);
    if (!clanId) return res.status(400).json({ error: 'Invalid clan ID' });
    try {
        const [[clan]] = await dbClans.query('SELECT * FROM clans WHERE id = ?', [clanId]);
        if (!clan) return res.status(404).json({ error: 'Clan not found' });

        const [members] = await dbClans.query(
            'SELECT * FROM clan_members WHERE clanId = ? ORDER BY activityPoints DESC',
            [clanId]
        );

        const [enrichedMembers, owner] = await Promise.all([
            Promise.all(members.map(async m => ({ ...m, ...await getUser(m.userId) }))),
            getUser(clan.ownerId),
        ]);

        res.json({ ...clan, owner, members: enrichedMembers });
    } catch (err) {
        console.error('Clan detail error:', err.message);
        res.status(500).json({ error: 'Database error' });
    }
});

const clanApplyCooldown = new Map();
app.post('/api/clan/:id/apply', requireAuth, express.json(), async (req, res) => {
    const clanId = parseInt(req.params.id);
    if (!clanId) return res.status(400).json({ error: 'Неверный клан' });
    const user = req.session.user;
    const message = String(req.body?.message || '').slice(0, 500).trim();

    const key = `${user.id}:${clanId}`;
    const now = Date.now();
    if (clanApplyCooldown.get(key) && now - clanApplyCooldown.get(key) < 60_000)
        return res.status(429).json({ error: 'Ты уже отправил заявку — подожди минуту.' });

    const bot = discordBot;
    if (!bot) return res.status(503).json({ error: 'Бот недоступен' });

    try {
        const [[clan]] = await dbClans.query('SELECT * FROM clans WHERE id = ?', [clanId]);
        if (!clan) return res.status(404).json({ error: 'Клан не найден' });

        const [[already]] = await dbClans.query(
            'SELECT 1 AS x FROM clan_members WHERE clanId = ? AND userId = ?', [clanId, user.id]
        ).catch(() => [[null]]);
        if (already) return res.status(400).json({ error: 'Ты уже в этом клане.' });

        const avatarUrl = user.avatar
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
        const embed = {
            title: '📨 Заявка в клан',
            description: `<@${user.id}> хочет вступить в клан **${clan.clanName}**.`,
            color: clan.clanColor ? Number(clan.clanColor) : 0x8b5fe8,
            fields: [
                { name: 'Кандидат', value: `<@${user.id}> · ${user.username} (\`${user.id}\`)`, inline: false },
                ...(message ? [{ name: 'Сообщение', value: message, inline: false }] : []),
            ],
            thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
            footer: { text: 'Talori · Кланы' },
            timestamp: new Date().toISOString(),
        };

        let delivered = null;
        if (clan.ownerId) {
            try {
                const { data: dm } = await bot.post('/users/@me/channels', { recipient_id: String(clan.ownerId) });
                await bot.post(`/channels/${dm.id}/messages`, {
                    content: 'Новая заявка в твой клан:',
                    embeds: [embed],
                });
                delivered = 'dm';
            } catch (e) {
                delivered = null;
            }
        }

        if (!delivered) {
            const chatChannel = clan.clanChannel || clan.channelId || clan.clanChatId
                || clan.textChannelId || clan.chatChannelId || clan.clanTextChannel || null;
            if (chatChannel) {
                try {
                    await bot.post(`/channels/${chatChannel}/messages`, {
                        content: `<@${clan.ownerId}>, новая заявка в клан (ЛС закрыты):`,
                        embeds: [embed],
                    });
                    delivered = 'chat';
                } catch (e) {
                    console.error('Clan apply chat error:', e.response?.data ?? e.message);
                }
            }
        }

        if (!delivered)
            return res.status(502).json({ error: 'Не удалось доставить заявку: у лидера закрыты ЛС, а чат клана недоступен. Напиши лидеру напрямую.' });

        clanApplyCooldown.set(key, now);
        res.json({ ok: true, via: delivered });
    } catch (err) {
        console.error('Clan apply error:', err.response?.data ?? err.message);
        res.status(500).json({ error: 'Не удалось отправить заявку' });
    }
});

app.get('/api/profile/:id', async (req, res) => {
    const userId = String(req.params.id).replace(/\D/g, '');
    if (!userId || userId.length < 17) return res.status(400).json({ error: 'Invalid ID' });

    try {
        let discordUser = null;
        try {
            const { data: u } = await discordBot.get(`/users/${userId}`);
            discordUser = {
                username: u.global_name || u.username,
                avatar:   u.avatar  || null,
                banner:   u.banner  || null,
            };
        } catch {
            return res.status(404).json({ error: 'User not found' });
        }

        let memberRoles = null;
        if (guildBot) {
            try {
                const { data: m } = await guildBot.get(`/guilds/${GUILD_ID}/members/${userId}`);
                memberRoles = m.roles || [];
            } catch {}
        }

        const profile = await buildProfile(userId, discordUser, memberRoles);
        res.json(profile);
    } catch (err) {
        console.error('[/api/profile/:id]', err.message);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/api/stats/mafia/players', async (req, res) => {
    try {
        const pFile = path.join(__dirname, '..', 'Mafia', 'data', 'player_stats.json');
        let pData = {};
        try { pData = JSON.parse(fs.readFileSync(pFile, 'utf8')); } catch {}

        const players = Object.entries(pData)
            .map(([uid, s]) => ({
                userId: uid,
                games: s.games || 0,
                wins: s.wins || 0,
                winRate: s.games >= 5 ? Math.round(s.wins / s.games * 100) : null,
                roles: s.roles || {},
                favRole: Object.entries(s.roles || {}).sort((a,b) => b[1].games - a[1].games)[0]?.[0] ?? null,
                bestRole: Object.entries(s.roles || {}).filter(([,v]) => v.games >= 3).sort((a,b) => (b[1].wins/b[1].games) - (a[1].wins/a[1].games))[0]?.[0] ?? null,
            }))
            .filter(p => p.games >= 5)
            .sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0))
            .slice(0, 25);

        const enriched = await Promise.all(players.map(async (p, i) => ({
            rank: i + 1, ...p, ...await getUser(p.userId),
        })));

        res.json(enriched);
    } catch (err) {
        console.error('Mafia players error:', err.message);
        res.json([]);
    }
});

app.get('/api/stats/mafia/me', requireAuth, (req, res) => {
    try {
        const pFile = path.join(__dirname, '..', 'Mafia', 'data', 'player_stats.json');
        let pData = {};
        try { pData = JSON.parse(fs.readFileSync(pFile, 'utf8')); } catch {}
        const s = pData[req.session.user.id] ?? null;
        res.json(s ? {
            games: s.games,
            wins: s.wins,
            winRate: s.games >= 1 ? Math.round(s.wins / s.games * 100) : 0,
            roles: s.roles,
            favRole: Object.entries(s.roles || {}).sort((a,b) => b[1].games - a[1].games)[0]?.[0] ?? null,
        } : null);
    } catch { res.json(null); }
});

app.get('/api/stats/top', async (req, res) => {
    const type = req.query.type || 'balance';
    try {
        if (type === 'balance') {
            const [rows] = await dbEconomy.query(
                'SELECT userId, balance, level, xp FROM users ORDER BY balance DESC LIMIT 10'
            );
            return res.json(await Promise.all(rows.map(async (r, i) => ({ rank: i+1, ...r, ...await getUser(r.userId) }))));
        }
        if (type === 'xp') {
            const [rows] = await dbEconomy.query(
                'SELECT userId, xp, level, messageCount FROM users ORDER BY xp DESC LIMIT 10'
            );
            return res.json(await Promise.all(rows.map(async (r, i) => ({ rank: i+1, ...r, ...await getUser(r.userId) }))));
        }
        if (type === 'voice') {
            const [rows] = await dbEconomy.query(
                'SELECT userId, voiceTime, level FROM users WHERE voiceTime > 0 ORDER BY voiceTime DESC LIMIT 10'
            );
            return res.json(await Promise.all(rows.map(async (r, i) => ({ rank: i+1, ...r, ...await getUser(r.userId) }))));
        }
        if (type === 'staff') {
            const [rows] = await db.query(
                'SELECT memberId, type, verifiesAll, warnsAll, mutesAll, bansAll FROM staff ORDER BY verifiesAll + warnsAll + mutesAll + bansAll DESC LIMIT 10'
            );
            return res.json(await Promise.all(rows.map(async (r, i) => ({ rank: i+1, ...r, ...await getUser(r.memberId) }))));
        }
        if (type === 'clans') {
            const [rows] = await dbClans.query(
                'SELECT id, clanName, clanColor, clanLogo, clanRating, clanLevel, ownerId FROM clans ORDER BY clanRating DESC LIMIT 10'
            );
            return res.json(await Promise.all(rows.map(async (r, i) => ({ rank: i+1, ...r, owner: await getUser(r.ownerId) }))));
        }
        res.json([]);
    } catch (err) {
        console.error('Stats top error:', err.message);
        res.json([]);
    }
});

app.get('/api/stats/giveaways', async (req, res) => {
    try {
        const [recent] = await dbGiveaway.query(
            'SELECT name, winnersCount, expired, winners, members FROM giveaways ORDER BY expired DESC LIMIT 10'
        );
        const parsed = recent.map(g => ({
            name: g.name,
            winnersCount: g.winnersCount,
            expired: g.expired,
            winners: safeJSON(g.winners, []),
            participants: safeJSON(g.members, []).length,
        }));
        res.json(parsed);
    } catch (err) {
        res.json([]);
    }
});

app.get('/api/stats/activity', async (req, res) => {
    try {
        const [[ecoStats]]  = await dbEconomy.query('SELECT COUNT(*) AS users, SUM(messageCount) AS messages, SUM(voiceTime) AS voice FROM users').catch(() => [[{}]]);
        const [[staffStats]] = await db.query('SELECT COUNT(*) AS staffCount, SUM(verifiesAll) AS verifies FROM staff').catch(() => [[{}]]);
        const [[clanStats]]  = await dbClans.query('SELECT COUNT(*) AS clansCount, COUNT(DISTINCT userId) AS clanMembers FROM clan_members').catch(() => [[{}]]);
        const [[gwStats]]    = await dbGiveaway.query('SELECT COUNT(*) AS total FROM giveaways').catch(() => [[{}]]);

        let mafiaGames = 0;
        try {
            const s = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'Mafia', 'data', 'stats.json'), 'utf8'));
            mafiaGames = s[GUILD_ID]?.totalGames || 0;
        } catch {}

        res.json({
            users:      ecoStats?.users || 0,
            messages:   ecoStats?.messages || 0,
            voiceMs:    Number(ecoStats?.voice) || 0,
            staffCount: staffStats?.staffCount || 0,
            verifies:   staffStats?.verifies || 0,
            clans:      clanStats?.clansCount || 0,
            clanMembers: clanStats?.clanMembers || 0,
            giveaways:  gwStats?.total || 0,
            mafiaGames,
        });
    } catch (err) {
        console.error('Activity error:', err.message);
        res.json({});
    }
});

function safeJSON(val, fallback) {
    if (Array.isArray(val)) return val;
    try { return JSON.parse(val) ?? fallback; } catch { return fallback; }
}

const MAFIA_BOT_TOKEN = process.env.MAFIA_BOT_TOKEN || '';
const mafiaDiscord = MAFIA_BOT_TOKEN
  ? axios.create({ baseURL: 'https://discord.com/api/v10', headers: { Authorization: `Bot ${MAFIA_BOT_TOKEN}` } })
  : null;

async function announceDiscord(sess, text) {
  if (!mafiaDiscord || !sess.chatChannelId) return;
  await mafiaDiscord.post(`/channels/${sess.chatChannelId}/messages`, { content: text }).catch(() => {});
}

function broadcast(sess) {
  const pub  = sess.game.publicState();
  const host = sess.game.hostState();
  for (const [uid, sk] of sess.sockets) {
    sk.emit('state', pub);
    if (sess.hostFlags?.get(uid)) {
      sk.emit('host_state', host);
    } else {
      const ps = sess.game.playerState(uid);
      if (ps) sk.emit('player_state', ps);
    }
  }
}

app.post('/api/mafia/create', express.json(), (req, res) => {
  const secret = req.headers['x-bot-secret'] || '';
  if (MAFIA_BOT_SECRET && secret !== MAFIA_BOT_SECRET)
    return res.status(403).json({ error: 'Forbidden' });

  const { hostDiscordId, guildId, chatChannelId } = req.body;
  if (!hostDiscordId || !guildId)
    return res.status(400).json({ error: 'hostDiscordId and guildId required' });

  const sessionId = require('crypto').randomUUID();
  const game      = new MafiaGame();

  mafiaSessions.set(sessionId, {
    sessionId,
    hostDiscordId: String(hostDiscordId),
    guildId:       String(guildId),
    chatChannelId: chatChannelId || null,
    game,
    sockets: new Map(),
  });

  setTimeout(() => mafiaSessions.delete(sessionId), 6 * 60 * 60 * 1000);

  const url = `${WEBSITE_URL}/mafia/${sessionId}`;
  console.log(`[Mafia] Сессия создана: ${sessionId} (host: ${hostDiscordId})`);
  res.json({ sessionId, url });
});

const MAFIA_PROPOSE_CHANNEL = ids.channels.mafiaPropose;

app.post('/api/mafia/propose', requireAuth, async (req, res) => {
    const user = req.session.user;
    const bot  = mafiaDiscord || guildBot;
    if (!bot) return res.status(503).json({ error: 'Bot unavailable' });

    const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : null;

    try {
        await bot.post(`/channels/${MAFIA_PROPOSE_CHANNEL}/messages`, {
            content: `<@&${HOST_ROLE_ID}> — <@${user.id}> хочет сыграть в **Мафию**!`,
            allowed_mentions: { roles: [HOST_ROLE_ID], users: [user.id] },
            embeds: [{
                title: '🎭 Запрос на игру · Мафия',
                description: `<@${user.id}> ищет партию — нужен ведущий!`,
                fields: [
                    { name: 'Игрок', value: `<@${user.id}> (\`${user.id}\`)`, inline: false },
                ],
                thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
                color: 0x5865f2,
                timestamp: new Date().toISOString(),
                footer: { text: 'Talori · Мафия' },
            }],
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('Propose error:', err.response?.data ?? err.message);
        res.status(500).json({ error: 'Failed to send' });
    }
});

const POKER_PROPOSE_CHANNEL = ids.channels.pokerPropose;

app.post('/api/poker/propose', requireAuth, async (req, res) => {
    const user = req.session.user;
    const bot  = mafiaDiscord || guildBot;
    if (!bot) return res.status(503).json({ error: 'Bot unavailable' });

    const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
        : null;

    try {
        await bot.post(`/channels/${POKER_PROPOSE_CHANNEL}/messages`, {
            content: `<@${user.id}> хочет сыграть в **Покер**!`,
            embeds: [{
                title: 'Запрос на игру',
                fields: [
                    { name: 'Пользователь', value: `<@${user.id}> / ${user.id}`, inline: false },
                    { name: 'Игра',         value: 'Покер · 5-card draw',          inline: false },
                ],
                thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
                color: 0xa83838,
            }],
        });
        res.json({ ok: true });
    } catch (err) {
        console.error('Poker propose error:', err.response?.data ?? err.message);
        res.status(500).json({ error: 'Failed to send' });
    }
});

app.get('/poker', (req, res) => res.sendFile(path.join(__dirname, 'poker.html')));

const pokerSessions = new Map();
const POKER_BOT_SECRET = process.env.POKER_BOT_SECRET || MAFIA_BOT_SECRET;

const CURRENCIES = {
  luna:  { name: 'Луна',  db: dbEco,     table: 'users', col: 'balance', idCol: 'memberId' },
  torii: { name: 'Тории', db: dbEconomy, table: 'users', col: 'balance', idCol: 'memberId' },
};

async function getBalance(currency, userId) {
  const c = CURRENCIES[currency];
  if (!c) return null;
  try {
    const [[row]] = await c.db.query(`SELECT \`${c.col}\` AS bal FROM \`${c.table}\` WHERE \`${c.idCol}\` = ?`, [userId]);
    return row ? Number(row.bal) : 0;
  } catch (e) { console.error('getBalance:', e.message); return null; }
}
async function addBalance(currency, userId, delta) {
  const c = CURRENCIES[currency];
  if (!c) return false;
  try {
    await c.db.query(`UPDATE \`${c.table}\` SET \`${c.col}\` = \`${c.col}\` + ? WHERE \`${c.idCol}\` = ?`, [delta, userId]);
    return true;
  } catch (e) { console.error('addBalance:', e.message); return false; }
}

function pokerBroadcast(sess) {
  const pub = { ...sess.game.publicState(), locked: !!sess.locked };
  for (const [uid, sk] of sess.sockets) {
    sk.emit('state', pub);
    const ps = sess.game.playerState(uid);
    if (ps) sk.emit('me', ps);
  }
}

function pokerTick(sess) {
  clearTimeout(sess._timer);
  const g = sess.game;
  if (g.phase === PokerPhase.WAITING && g.handNo > 0) {
    sess._timer = setTimeout(() => {
      if (g.canPlay().length >= g.minPlayers) { g.startHand(); }
      pokerBroadcast(sess);
      pokerTick(sess);
    }, 7000);
  }
}

async function pokerCashOut(sess, userId) {
  if (!sess.currency) return;
  const pl = sess.game.players.get(String(userId));
  if (!pl || pl._cashedOut) return;
  pl._cashedOut = true;
  if (pl.chips > 0) await addBalance(sess.currency, userId, pl.chips);
}
async function pokerSettleIfNeeded() {   }

app.post('/api/poker/create', express.json(), async (req, res) => {
  const secret = req.headers['x-bot-secret'] || '';
  if (POKER_BOT_SECRET && secret !== POKER_BOT_SECRET) return res.status(403).json({ error: 'Forbidden' });

  const { hostDiscordId, guildId, chatChannelId, currency = 'luna', buyIn = 1000 } = req.body;
  if (!hostDiscordId || !guildId) return res.status(400).json({ error: 'hostDiscordId and guildId required' });

  const cur = CURRENCIES[currency] ? currency : null;
  const sessionId = require('crypto').randomUUID();
  const game = new PokerGame({ startChips: Number(buyIn) || 1000 });

  pokerSessions.set(sessionId, {
    sessionId, game, hostId: String(hostDiscordId), guildId: String(guildId),
    chatChannelId: chatChannelId || null, currency: cur, buyIn: Number(buyIn) || 1000,
    sockets: new Map(), _timer: null,
  });
  setTimeout(() => { const s = pokerSessions.get(sessionId); if (s) clearTimeout(s._timer); pokerSessions.delete(sessionId); }, 6 * 60 * 60 * 1000);

  console.log(`[Poker] Стол создан: ${sessionId} (host ${hostDiscordId}, валюта ${cur || 'fun'})`);
  res.json({ sessionId, url: `${WEBSITE_URL}/poker/${sessionId}` });
});

app.post('/api/poker/table', requireAuth, express.json(), async (req, res) => {
  const user = req.session.user;
  const isPublic  = !!req.body?.isPublic;
  const recipient = req.body?.recipient ? String(req.body.recipient).trim() : null;
  const sessionId = require('crypto').randomUUID();
  const tableUrl  = `${WEBSITE_URL}/poker/${sessionId}`;
  const game = new PokerGame({ startChips: 1000 });
  pokerSessions.set(sessionId, {
    sessionId, game, isPublic, hostId: user.id, guildId: 'web',
    chatChannelId: null, currency: null, buyIn: 1000, sockets: new Map(), _timer: null,
  });
  setTimeout(() => { const s = pokerSessions.get(sessionId); if (s) clearTimeout(s._timer); pokerSessions.delete(sessionId); }, 3 * 60 * 60 * 1000);

  const bot = mafiaDiscord || guildBot;
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`
    : null;

  if (isPublic && bot) {
    bot.post(`/channels/${POKER_PROPOSE_CHANNEL}/messages`, {
      content: `<@${user.id}> открыл покерный стол — **присоединяйтесь!**`,
      embeds: [{
        title: 'Покер · Открытый стол',
        description: `**Ведущий:** <@${user.id}>\n**Формат:** Техасский Холдём · 3–5 игроков`,
        color: 0xa83838,
        thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
        footer: { text: 'Talori · Покер' },
      }],
      components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Сесть за стол', url: tableUrl }] }],
    }).catch(e => console.error('Poker announce error:', e.response?.data ?? e.message));
  }

  if (!isPublic && recipient && bot) {
    bot.post('/users/@me/channels', { recipient_id: recipient })
      .then(({ data: dm }) => bot.post(`/channels/${dm.id}/messages`, {
        content: `<@${user.id}> приглашает тебя сыграть в **Покер** · приватный стол`,
        embeds: [{
          title: 'Покер · Приватный стол',
          description: `**Ведущий:** <@${user.id}>\n**Игроков:** 2–5`,
          color: 0xa83838,
          thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
          footer: { text: 'Talori · Покер' },
        }],
        components: [{ type: 1, components: [{ type: 2, style: 5, label: 'Присоединиться', url: tableUrl }] }],
      }))
      .catch(e => console.error('Poker DM error:', e.response?.data ?? e.message));
  }

  res.json({ sessionId, url: tableUrl, isPublic });
});

app.get('/poker/:sessionId', (req, res) => res.sendFile(path.join(__dirname, 'poker-table.html')));

const pokerIo = new SocketIO(httpServer, { path: '/poker-ws', cors: { origin: '*', credentials: true } });
pokerIo.engine.use(sessionMiddleware);

pokerIo.on('connection', (socket) => {
  const user = socket.request.session?.user;
  if (!user) { socket.disconnect(); return; }
  const userId = user.id;
  let sess = null;

  socket.on('identify', ({ sessionId }) => {
    sess = pokerSessions.get(sessionId);
    if (!sess) { socket.emit('error_msg', 'Стол не найден или закрыт.'); return; }
    if (sess.sockets.has(userId)) sess.sockets.get(userId).disconnect();
    sess.sockets.set(userId, socket);
    const seated = sess.game.players.has(userId);
    socket.emit('identified', { userId, username: user.username, isHost: userId === sess.hostId, seated, currency: sess.currency, buyIn: sess.buyIn, isPublic: !!sess.isPublic, locked: !!sess.locked });
    socket.emit('state', sess.game.publicState());
    const ps = sess.game.playerState(userId);
    if (ps) socket.emit('me', ps);
  });

  socket.on('sit', async () => {
    if (!sess) return;
    if (sess.locked) { socket.emit('error_msg', 'Стол закрыт — ведущий запретил вход.'); return; }
    if (sess.game.players.has(userId)) return;
    if (sess.currency) {
      const bal = await getBalance(sess.currency, userId);
      if (bal === null) { socket.emit('error_msg', 'Не удалось проверить баланс.'); return; }
      if (bal < sess.buyIn) { socket.emit('error_msg', `Недостаточно ${CURRENCIES[sess.currency].name}: нужно ${sess.buyIn}.`); return; }
      await addBalance(sess.currency, userId, -sess.buyIn);
    }
    const ok = sess.game.registerPlayer(userId, user.username, user.avatar ?? null);
    if (!ok) { if (sess.currency) await addBalance(sess.currency, userId, sess.buyIn); socket.emit('error_msg', 'Стол заполнен (максимум 5 игроков).'); return; }
    sess.game.log(`${user.username} сел за стол.`);
    pokerBroadcast(sess);
  });

  socket.on('start', () => {
    if (!sess) return;
    if (userId !== sess.hostId) { socket.emit('error_msg', 'Запускать раздачу может только ведущий стола.'); return; }
    if (sess.game.phase !== PokerPhase.WAITING) return;
    const r = sess.game.startHand();
    if (r.error) { socket.emit('error_msg', r.error); return; }
    pokerBroadcast(sess);
    pokerTick(sess);
  });

  socket.on('lock', () => {
    if (!sess || userId !== sess.hostId) return;
    sess.locked = !sess.locked;
    pokerBroadcast(sess);
  });

  socket.on('action', ({ type, amount }) => {
    if (!sess) return;
    const r = sess.game.act(userId, { type, amount });
    if (r?.error) { socket.emit('error_msg', r.error); return; }
    pokerBroadcast(sess);
    pokerTick(sess);
  });

  socket.on('leave', async () => {
    if (!sess) return;
    await pokerCashOut(sess, userId);
    sess.game.removePlayer(userId);
    pokerBroadcast(sess);
  });

  socket.on('disconnect', () => { if (sess) sess.sockets.delete(userId); });
});

app.get('/mafia/training', requireAuth, (req, res) => {
  const roles = new Set(req.session.user.memberRoles || []);
  if (!roles.has(HOST_ROLE_ID) && !OWNER_IDS.has(req.session.user.id))
    return res.redirect('/mafia?access=denied');
  res.sendFile(path.join(__dirname, 'mafia-training.html'));
});

app.get('/mafia/solo', (req, res) => res.sendFile(path.join(__dirname, 'mafia-training.html')));
app.get('/mafia/solo/:sessionId', (req, res) => res.sendFile(path.join(__dirname, 'mafia-training.html')));

app.get('/mafia/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'mafia.html'));
});

const io = new SocketIO(httpServer, { path: '/mafia-ws', cors: { origin: '*', credentials: true } });
io.engine.use(sessionMiddleware);

io.on('connection', async (socket) => {
  const user = socket.request.session?.user;
  if (!user) { socket.disconnect(); return; }

  const userId = user.id;
  let sess     = null;

  socket.on('identify', ({ sessionId }) => {
    if (!sessionId) return;
    sess = mafiaSessions.get(sessionId);
    if (!sess) { socket.emit('error_msg', 'Сессия не найдена или истекла.'); return; }

    const memberRoles = new Set(user.memberRoles || []);
    const userIsHost  = userId === sess.hostDiscordId &&
                        (memberRoles.has(HOST_ROLE_ID) || OWNER_IDS.has(userId));

    if (!sess.hostFlags) sess.hostFlags = new Map();
    sess.hostFlags.set(userId, userIsHost);

    if (sess.sockets.has(userId)) sess.sockets.get(userId).disconnect();
    sess.sockets.set(userId, socket);

    socket.emit('identified', { isHost: userIsHost, userId, username: user.username });

    socket.emit('state', sess.game.publicState());
    if (userIsHost) {
      socket.emit('host_state', sess.game.hostState());
    } else {
      const ps = sess.game.playerState(userId);
      if (ps) socket.emit('player_state', ps);
    }
  });

  socket.on('disconnect', () => {
    if (sess) sess.sockets.delete(userId);
  });

  socket.on('join', () => {
    if (!sess) return;
    if (userId === sess.hostDiscordId) {
      socket.emit('error_msg', 'Ведущий не участвует как игрок.');
      return;
    }
    if (sess.game.phase !== GamePhase.WAITING) {
      socket.emit('error_msg', 'Регистрация уже закрыта.');
      return;
    }
    const ok = sess.game.registerPlayer(userId, user.username, user.avatar ?? null);
    if (!ok) {
      socket.emit('error_msg', 'Ты уже в списке или лимит участников (20) достигнут.');
      return;
    }
    sess.game.addEvent(`${user.username} присоединился к игре.`);
    broadcast(sess);
    announceDiscord(sess, `✅ **${user.username}** записался на игру (${sess.game.players.size} участников).`);
  });

  socket.on('leave', () => {
    if (!sess || sess.game.phase !== GamePhase.WAITING) return;
    const ok = sess.game.removePlayer(userId);
    if (ok) {
      sess.game.addEvent(`${user.username} покинул игру.`);
      broadcast(sess);
    }
  });

  socket.on('player:night_action', ({ action, targetId }) => {
    if (!sess || sess.game.phase !== GamePhase.NIGHT) return;
    const actor  = sess.game.getPlayer(userId);
    if (!actor?.isAlive) { socket.emit('error_msg', 'Ты уже выбыл.'); return; }

    const target = targetId ? sess.game.getPlayer(targetId) : null;

    if (action === 'skip') {
      actor.nightTarget = null;
      socket.emit('night_result', { text: 'Ты пропускаешь ход.' });
      sess.game.addHostLog(`⏭ ${actor.gameName} пропустил ночной ход.`);

    } else if (action === 'k') {
      if (!target?.isAlive) { socket.emit('error_msg', 'Недопустимая цель.'); return; }
      sess.game.recordMafiaVote(actor, target);
      socket.emit('night_result', { text: `Твой голос: **${target.gameName}**.` });
      sess.game.addHostLog(`🎩 ${actor.gameName} → убить **${target.gameName}**`);

    } else if (action === 'dc') {
      if (!target?.isAlive) { socket.emit('error_msg', 'Недопустимая цель.'); return; }
      const isComm = target.roleId === RoleID.COMMISSIONER;
      socket.emit('night_result', { text: `**${target.gameName}**: ${isComm ? '+ Комиссар!' : '− не Комиссар'}` });
      sess.game.addHostLog(`👑 Дон ${actor.gameName} проверил ${target.gameName}: ${isComm ? 'КОМИССАР' : 'нет'}`);

    } else if (action === 'c') {
      if (!target?.isAlive) { socket.emit('error_msg', 'Недопустимая цель.'); return; }
      sess.game.recordNightAction(actor, target);
      const hit = target.isDetectedByCommissioner();
      socket.emit('night_result', { text: `**${target.gameName}**: ${hit ? '+ Мафия/Маньяк' : '− Мирный'}`, isArrestAvailable: hit && sess.game.dayNumber === 1 });
      sess.game.addHostLog(`🕵️ Комиссар ${actor.gameName} → ${target.gameName}: ${hit ? '+ МАФИЯ' : '− мирный'}`);

    } else if (action === 'ck') {
      if (!target?.isAlive || !target.isMafiaAligned()) { socket.emit('error_msg', 'Нельзя арестовать.'); return; }
      if (sess.game.dayNumber !== 1) { socket.emit('error_msg', 'Лучший ход — только первая ночь.'); return; }
      actor.commissionerArrest = true;
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Арест оформлен — **${target.gameName}** будет задержан утром.` });
      sess.game.addHostLog(`🚔 Комиссар ${actor.gameName} АРЕСТ → ${target.gameName}`);

    } else if (action === 'h') {
      if (!target?.isAlive) { socket.emit('error_msg', 'Недопустимая цель.'); return; }
      if (target.id === actor.id && actor.doctorHealedSelf) { socket.emit('error_msg', 'Самолечение уже использовано.'); return; }
      if (target.id !== actor.id && (sess.game.dayNumber - (actor.doctorLastHealedNight ?? 0)) < 2) { socket.emit('error_msg', 'Других можно лечить только через ночь.'); return; }
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Ты лечишь **${target.gameName}** этой ночью.` });
      sess.game.addHostLog(`🩺 Доктор ${actor.gameName} лечит → ${target.gameName}`);

    } else if (action === 'b') {
      if (!target?.isAlive) { socket.emit('error_msg', 'Недопустимая цель.'); return; }
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Ты блокируешь **${target.gameName}** этой ночью.` });
      sess.game.addHostLog(`🍷 Путана ${actor.gameName} блокирует → ${target.gameName}`);

    } else if (action === 'g') {
      if (!target?.isAlive || target.id === actor.id) { socket.emit('error_msg', 'Недопустимая цель.'); return; }
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Ты охраняешь **${target.gameName}** этой ночью.` });
      sess.game.addHostLog(`🛡️ Телохранитель ${actor.gameName} охраняет → ${target.gameName}`);

    } else if (action === 'va') {
      sess.game.recordNightAction(actor, actor);
      socket.emit('night_result', { text: `Боевая готовность! Осталось: **${actor.veteranAlerts}**.` });
      sess.game.addHostLog(`🎖️ Ветеран ${actor.gameName} активировал алерт`);

    } else if (action === 'm') {
      if (!target?.isAlive) { socket.emit('error_msg', 'Недопустимая цель.'); return; }
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Цель выбрана: **${target.gameName}**.` });
      sess.game.addHostLog(`🔪 Маньяк ${actor.gameName} → ${target.gameName}`);

    } else if (action === 'wc') {
      if (!target?.isAlive) { socket.emit('error_msg', 'Недопустимая цель.'); return; }
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Ты контролируешь **${target.gameName}** этой ночью.` });
      sess.game.addHostLog(`🧙 Ведьма ${actor.gameName} контролирует → ${target.gameName}`);
    }

    const hostSock = sess.sockets.get(sess.hostDiscordId);
    if (hostSock) hostSock.emit('host_state', sess.game.hostState());
  });

  socket.on('player:vote', ({ targetId }) => {
    if (!sess || sess.game.phase !== GamePhase.VOTING) return;
    const voter = sess.game.getPlayer(userId);
    if (!voter?.isAlive) { socket.emit('error_msg', 'Ты уже выбыл.'); return; }

    if (!targetId) {
      sess.game._votes.delete(userId);
      sess.game._weights.delete(userId);
      socket.emit('night_result', { text: 'Ты воздержался.' });
    } else {
      const target = sess.game.getPlayer(targetId);
      if (!target?.isAlive) { socket.emit('error_msg', 'Игрок недоступен.'); return; }
      const msg = sess.game.castVote(voter, target);
      socket.emit('night_result', { text: msg });
    }
    broadcast(sess);
  });

  function requireHost() {
    if (!sess) { socket.emit('error_msg', 'Сессия не найдена.'); return false; }
    if (!sess.hostFlags?.get(userId)) { socket.emit('error_msg', 'Только для ведущего.'); return false; }
    return true;
  }

  socket.on('host:settings', ({ allowedRoles, mafiaCount, nightTimeoutSec }) => {
    if (!requireHost()) return;
    if (sess.game.phase !== GamePhase.WAITING) { socket.emit('error_msg', 'Настройки только до старта.'); return; }
    if (Array.isArray(allowedRoles)) sess.game.settings.allowedRoles = allowedRoles;
    if (mafiaCount !== undefined) sess.game.settings.mafiaCount = mafiaCount === 0 ? null : Number(mafiaCount);
    if (nightTimeoutSec !== undefined) sess.game.settings.nightTimeoutSec = Number(nightTimeoutSec);
    broadcast(sess);
  });

  socket.on('host:kick', ({ targetId }) => {
    if (!requireHost()) return;
    if (sess.game.phase !== GamePhase.WAITING) { socket.emit('error_msg', 'Выгнать можно только до старта.'); return; }
    const p = sess.game.getPlayer(targetId);
    if (!p) { socket.emit('error_msg', 'Игрок не найден.'); return; }
    const name = p.displayName;
    sess.game.removePlayer(targetId);
    sess.game.addEvent(`${name} выгнан ведущим.`);
    broadcast(sess);
  });

  socket.on('host:start', () => {
    if (!requireHost()) return;
    if (sess.game.phase !== GamePhase.WAITING) { socket.emit('error_msg', 'Игра уже идёт.'); return; }
    if (sess.game.players.size < 8) { socket.emit('error_msg', `Недостаточно игроков: ${sess.game.players.size}/8.`); return; }
    const mc = sess.game.settings.mafiaCount;
    if (mc !== null && mc >= sess.game.players.size) { socket.emit('error_msg', 'Слишком много мафии.'); return; }

    try { sess.game.assignRoles(); } catch (e) { socket.emit('error_msg', e.message); return; }
    sess.game.phase     = GamePhase.DAY;
    sess.game.dayNumber = 1;

    sess.game.addEvent('🎭 Игра началась! Роли розданы. Первый день.');

    const mafPlayers = [...sess.game.players.values()].filter(p => p.isMafiaAligned());
    const mafNames   = mafPlayers.map(p => `${p.role.emoji} ${p.gameName} [${p.gameNumber}] — ${p.role.name}`).join('\n');
    sess.game.addHostLog(`── Состав мафии ──\n${mafNames || '—'}`);
    const allRoles = [...sess.game.players.values()].map(p =>
      `[${p.gameNumber}] ${p.displayName} — ${p.role.emoji} ${p.role.name}`
    ).join('\n');
    sess.game.addHostLog(`── Все роли ──\n${allRoles}`);

    broadcast(sess);

    for (const [uid, sk] of sess.sockets) {
      if (uid !== sess.hostDiscordId) {
        const ps = sess.game.playerState(uid);
        if (ps) sk.emit('player_state', ps);
        sk.emit('role_reveal', ps?.role ?? null);
      }
    }

    announceDiscord(sess, `🎭 **Игра Мафия началась!** ${sess.game.players.size} участников. Роли розданы — проверьте сайт.`);
  });

  socket.on('host:day', () => {
    if (!requireHost()) return;
    if (sess.game.phase !== GamePhase.NIGHT && sess.game.phase !== GamePhase.DAY) { socket.emit('error_msg', 'Нельзя.'); return; }

    if (sess.game.phase === GamePhase.NIGHT) {
      const nightEvents = sess.game.processNight();
      sess.game.dayNumber++;

      const nightLog = nightEvents.length ? nightEvents.join('\n') : 'Ночь прошла спокойно.';
      sess.game.addHostLog(`── Итоги ночи ${sess.game.dayNumber - 1} ──\n${nightLog}`);

      for (const ev of nightEvents) sess.game.addEvent(ev);
    }

    const winner = sess.game.checkWinner();
    if (winner) {
      sess.game.phase = GamePhase.FINISHED;
      sess.game.addEvent(`🏆 ${winner}`);
      broadcast(sess);
      announceDiscord(sess, `🏆 **Игра завершена!** ${winner}`);
      return;
    }

    sess.game.phase = GamePhase.DAY;
    sess.game.addEvent(`☀️ День ${sess.game.dayNumber}. Обсуждение началось.`);
    broadcast(sess);
    announceDiscord(sess, `☀️ **День ${sess.game.dayNumber}.** Город просыпается. Обсуждайте!`);
  });

  socket.on('host:night', () => {
    if (!requireHost()) return;
    if (sess.game.phase !== GamePhase.DAY && sess.game.phase !== GamePhase.VOTING) { socket.emit('error_msg', 'Нельзя.'); return; }

    sess.game.phase = GamePhase.NIGHT;
    sess.game.resetNight?.();
    sess.game._nominations.clear();
    sess.game._voteCandidates.clear();
    sess.game._votes.clear();
    sess.game._weights.clear();
    sess.game._voteOpen = false;

    sess.game.addEvent(`🌙 Ночь ${sess.game.dayNumber}. Город засыпает.`);

    broadcast(sess);

    for (const [uid, sk] of sess.sockets) {
      if (uid === sess.hostDiscordId) continue;
      const p = sess.game.getPlayer(uid);
      if (!p?.isAlive) continue;
      const ps = sess.game.playerState(uid);
      sk.emit('player_state', ps);

      const targets = [...sess.game.alivePlayers()]
        .filter(t => t.id !== uid || p.roleId === 'VETERAN')
        .map(t => ({ id: t.id, number: t.gameNumber, name: t.gameName }));

      const mafiaTargets = p.isMafiaAligned()
        ? targets.filter(t => !sess.game.getPlayer(t.id)?.isMafiaAligned())
        : targets;

      sk.emit('night_prompt', {
        hasAction: p.role.nightAction,
        action:    nightActionCode(p.roleId),
        desc:      p.role.actionDescription,
        targets:   p.isMafiaAligned() ? mafiaTargets : targets,
        allies:    p.isMafiaAligned() ? mafiaAllyList(sess.game, uid) : [],
      });
    }

    announceDiscord(sess, `🌙 **Ночь ${sess.game.dayNumber}.** Город засыпает. Выполните свои действия на сайте.`);
  });

  socket.on('host:nominate', ({ targetId }) => {
    if (!requireHost()) return;
    if (sess.game.phase !== GamePhase.DAY) { socket.emit('error_msg', 'Выставить можно только днём.'); return; }
    const p = sess.game.getPlayer(targetId);
    if (!p?.isAlive) { socket.emit('error_msg', 'Игрок недоступен.'); return; }
    if (sess.game._nominations.has(targetId)) {
      sess.game._nominations.delete(targetId);
      socket.emit('error_msg', `${p.gameName} снят с выставления.`);
    } else {
      sess.game._nominations.add(targetId);
    }
    broadcast(sess);
  });

  socket.on('host:vote_start', () => {
    if (!requireHost()) return;
    if (!sess.game._nominations.size) { socket.emit('error_msg', 'Никто не выставлен.'); return; }
    sess.game._voteCandidates = new Set(sess.game._nominations);
    sess.game._nominations.clear();
    sess.game.resetVote();
    sess.game._voteOpen = true;
    sess.game.phase = GamePhase.VOTING;

    const names = [...sess.game._voteCandidates].map(id => sess.game.getPlayer(id)?.gameName ?? id).join(', ');
    sess.game.addEvent(`⚖️ Голосование! На вылет выставлены: ${names}`);

    broadcast(sess);
    announceDiscord(sess, `⚖️ **Голосование началось!** Выставлены: ${names} — голосуйте на сайте.`);
  });

  socket.on('host:vote_end', () => {
    if (!requireHost()) return;
    if (!sess.game._voteOpen) { socket.emit('error_msg', 'Голосование не открыто.'); return; }

    const summary    = sess.game.voteSummary();
    const eliminated = sess.game.tallyVotes();
    let resultText   = '';
    let winner       = null;

    if (eliminated) {
      eliminated.isAlive = false;
      resultText = `Большинством голосов выбывает **${eliminated.gameName}**.`;

      if (eliminated.roleId === RoleID.JESTER) {
        winner = `🃏 **Шут** победил! **${eliminated.gameName}** добился казни.`;
      }
      for (const ex of [...sess.game.players.values()].filter(p => p.roleId === RoleID.EXECUTIONER && !p.executionerWon)) {
        if (ex.executionerTargetId === eliminated.id) {
          ex.executionerWon = true;
          winner = `⚖️ **Палач** победил! **${ex.gameName}** добился казни цели **${eliminated.gameName}**.`;
          break;
        }
      }
      if (eliminated.roleId === RoleID.HUNTER && !eliminated.hunterUsed) {
        eliminated.hunterUsed = true;
        const hunterSock = sess.sockets.get(eliminated.id);
        if (hunterSock) hunterSock.emit('night_result', { text: 'Тебя казнили! Как Охотник ты можешь взять одного с собой — сообщи ведущему номер.' });
      }
      sess.game.addHostLog(`⚔️ Казнь: ${eliminated.gameName} — ${eliminated.role.emoji} ${eliminated.role.name}`);
    } else {
      resultText = 'Голоса разделились — никто не выбывает.';
      sess.game.addHostLog('⚖️ Голоса разделились.');
    }

    sess.game._voteCandidates.clear();
    sess.game._voteOpen = false;
    sess.game._votes.clear();
    sess.game._weights.clear();
    sess.game.phase = GamePhase.DAY;

    const summaryText = summary.map(s => `${s.name}: ${s.votes}`).join(', ');
    sess.game.addEvent(`⚖️ Итог голосования: ${summaryText}. ${resultText}`);

    const gameWinner = winner || sess.game.checkWinner();
    if (gameWinner) {
      sess.game.phase = GamePhase.FINISHED;
      sess.game.addEvent(`🏆 ${gameWinner}`);
      broadcast(sess);
      announceDiscord(sess, `🏆 **Игра завершена!** ${gameWinner}`);
      return;
    }

    broadcast(sess);
    announceDiscord(sess, `⚖️ **Голосование завершено.** ${resultText}`);
  });

  socket.on('host:vote_reset', () => {
    if (!requireHost()) return;
    sess.game._nominations.clear();
    sess.game._voteCandidates.clear();
    sess.game.resetVote();
    sess.game._voteOpen = false;
    sess.game.phase = GamePhase.DAY;
    broadcast(sess);
  });

  socket.on('host:kill', ({ targetId }) => {
    if (!requireHost()) return;
    const p = sess.game.getPlayer(targetId);
    if (!p?.isAlive) { socket.emit('error_msg', 'Игрок недоступен.'); return; }
    p.isAlive = false;
    sess.game.addEvent(`⛔ ${p.gameName} выбыл по решению ведущего.`);
    sess.game.addHostLog(`⛔ Убит ведущим: ${p.gameName} — ${p.role.emoji} ${p.role.name}`);
    const gameWinner = sess.game.checkWinner();
    if (gameWinner) {
      sess.game.phase = GamePhase.FINISHED;
      sess.game.addEvent(`🏆 ${gameWinner}`);
      broadcast(sess);
      announceDiscord(sess, `🏆 **Игра завершена!** ${gameWinner}`);
      return;
    }
    broadcast(sess);
  });

  socket.on('host:end', () => {
    if (!requireHost()) return;
    sess.game.phase = GamePhase.FINISHED;
    sess.game.addEvent('Игра завершена ведущим.');
    broadcast(sess);
    announceDiscord(sess, '🛑 **Игра завершена** ведущим досрочно.');
    setTimeout(() => mafiaSessions.delete(sess.sessionId), 10 * 60 * 1000);
  });
});

function nightActionCode(roleId) {
  const map = {
    MAFIA: 'k', DON: 'k', WEREWOLF: 'k',
    DOCTOR: 'h', COMMISSIONER: 'c', PROSTITUTE: 'b',
    BODYGUARD: 'g', VETERAN: 'va', MANIAC: 'm', WITCH: 'wc',
  };
  return map[roleId] ?? 'skip';
}

function mafiaAllyList(game, excludeId) {
  return [...game.players.values()]
    .filter(p => p.isMafiaAligned() && p.id !== excludeId && p.isAlive)
    .map(p => ({ id: p.id, number: p.gameNumber, name: p.gameName, role: p.role.name }));
}

const SOLO_BOT_NAMES = [
  'Алиса','Борис','Виктор','Дарья','Егор','Жора','Зина','Иван',
  'Карен','Лена','Максим','Наташа','Олег','Полина','Рустам','Света',
  'Тимур','Ульяна','Федя','Хлоя',
];
function mkBotId(n) { return '__bot__' + n; }

function broadcastSolo(sess) {
  const pub = sess.game.publicState();
  const hs  = sess.game.hostState();
  for (const [uid, sk] of sess.sockets) {
    sk.emit('state', pub);
    if (uid === '__observer__') {
      sk.emit('host_state', hs);
    } else {
      const ps = sess.game.playerState(uid);
      if (ps) sk.emit('player_state', ps);
    }
  }
}

function randAlive(game, excludeIds = []) {
  const excl = new Set(excludeIds.map(String));
  const pool = game.alivePlayers().filter(p => !excl.has(p.id));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}

function botNightActions(sess) {
  const game = sess.game;
  for (const bid of sess.botIds) {
    const bot = game.getPlayer(bid);
    if (!bot?.isAlive) continue;
    const mafIds = game.alivePlayers().filter(p => p.isMafiaAligned()).map(p => p.id);
    switch (bot.roleId) {
      case 'MAFIA': case 'DON': case 'WEREWOLF': {
        const t = randAlive(game, mafIds);
        if (t) game.recordMafiaVote(bot, t);
        break;
      }
      case 'DOCTOR': {
        const pool = game.alivePlayers();
        const t = Math.random() < 0.2 ? bot : pool[Math.floor(Math.random() * pool.length)];
        if (t) game.recordNightAction(bot, t);
        break;
      }
      case 'COMMISSIONER': {
        const t = randAlive(game, [bid]);
        if (t) game.recordNightAction(bot, t);
        break;
      }
      case 'PROSTITUTE': case 'BODYGUARD': {
        const t = randAlive(game, [bid]);
        if (t) game.recordNightAction(bot, t);
        break;
      }
      case 'VETERAN': {
        if (bot.veteranAlerts > 0 && Math.random() < 0.35) game.recordNightAction(bot, bot);
        break;
      }
      case 'MANIAC': {
        const t = randAlive(game, [bid]);
        if (t) game.recordNightAction(bot, t);
        break;
      }
      case 'WITCH': {
        const t = randAlive(game, [bid]);
        if (t) game.recordNightAction(bot, t);
        break;
      }
    }
  }
}

function botVotes(sess) {
  const cands = [...sess.game._voteCandidates];
  if (!cands.length) return;
  for (const bid of sess.botIds) {
    const bot = sess.game.getPlayer(bid);
    if (!bot?.isAlive) continue;
    if (Math.random() < 0.15) continue;
    let chosen;
    if (bot.isMafiaAligned()) {
      const safe = cands.filter(id => !sess.game.getPlayer(id)?.isMafiaAligned());
      chosen = safe.length ? safe[Math.floor(Math.random() * safe.length)] : cands[Math.floor(Math.random() * cands.length)];
    } else {
      chosen = cands[Math.floor(Math.random() * cands.length)];
    }
    const target = sess.game.getPlayer(chosen);
    if (target?.isAlive) sess.game.castVote(bot, target);
  }
}

function soloProcessNight(sess) {
  clearTimeout(sess._timer);
  if (sess.game.phase !== 'NIGHT') return;
  botNightActions(sess);
  const evs = sess.game.processNight();
  sess.game.dayNumber++;
  for (const ev of evs) sess.game.addEvent(ev);
  const w = sess.game.checkWinner();
  if (w) { sess.game.phase = 'FINISHED'; sess.game.addEvent(`🏆 ${w}`); broadcastSolo(sess); return; }
  sess.game.phase = 'DAY';
  sess.game.addEvent(`☀️ День ${sess.game.dayNumber}. Обсуждение началось.`);
  broadcastSolo(sess);
  if (!sess.isHostMode) sess._timer = setTimeout(() => soloStartVoting(sess), 13000);
}

function soloStartVoting(sess) {
  clearTimeout(sess._timer);
  if (sess.game.phase !== 'DAY') return;
  const alive = sess.game.alivePlayers();
  if (alive.length < 2) return;
  const shuffled = alive.slice().sort(() => Math.random() - 0.5);
  const count = Math.random() < 0.35 ? 2 : 1;
  for (const p of shuffled.slice(0, count)) sess.game._nominations.add(p.id);
  sess.game._voteCandidates = new Set(sess.game._nominations);
  sess.game._nominations.clear();
  sess.game.resetVote();
  sess.game._voteOpen = true;
  sess.game.phase = 'VOTING';
  const names = [...sess.game._voteCandidates].map(id => sess.game.getPlayer(id)?.gameName ?? id).join(', ');
  sess.game.addEvent(`⚖️ Голосование! На вылет выставлены: ${names}`);
  broadcastSolo(sess);
  setTimeout(() => { botVotes(sess); broadcastSolo(sess); }, sess.isHostMode ? 1200 : 2000);
  if (!sess.isHostMode) sess._timer = setTimeout(() => soloEndVoting(sess), 18000);
}

function soloEndVoting(sess) {
  clearTimeout(sess._timer);
  if (sess.game.phase !== 'VOTING') return;
  const summary = sess.game.voteSummary();
  const elim    = sess.game.tallyVotes();
  let resultText = '';
  let winner = null;
  if (elim) {
    elim.isAlive = false;
    resultText = `Большинством голосов выбывает **${elim.gameName}**.`;
    if (elim.roleId === 'JESTER') winner = `🃏 **Шут** победил! **${elim.gameName}** добился казни.`;
  } else {
    resultText = 'Голоса разделились — никто не выбывает.';
  }
  sess.game._voteCandidates.clear();
  sess.game._voteOpen = false;
  sess.game._votes.clear();
  sess.game._weights.clear();
  sess.game.phase = 'DAY';
  const st = summary.map(s => `${s.name}: ${s.votes}`).join(', ') || 'никто не голосовал';
  sess.game.addEvent(`⚖️ Итог: ${st}. ${resultText}`);
  const gw = winner || sess.game.checkWinner();
  if (gw) { sess.game.phase = 'FINISHED'; sess.game.addEvent(`🏆 ${gw}`); broadcastSolo(sess); return; }
  broadcastSolo(sess);
  if (!sess.isHostMode) sess._timer = setTimeout(() => soloNight(sess), 5000);
}

function soloNight(sess) {
  clearTimeout(sess._timer);
  sess.game.phase = 'NIGHT';
  sess.game.resetNight();
  sess.game._nominations.clear();
  sess.game._voteCandidates.clear();
  sess.game._votes.clear();
  sess.game._weights.clear();
  sess.game._voteOpen = false;
  sess.game.addEvent(`🌙 Ночь ${sess.game.dayNumber}. Город засыпает.`);
  broadcastSolo(sess);

  if (sess.playerId) {
    const playerSock = sess.sockets.get(sess.playerId);
    const p = sess.game.getPlayer(sess.playerId);
    if (playerSock && p?.isAlive) {
      playerSock.emit('player_state', sess.game.playerState(sess.playerId));
      const all = sess.game.alivePlayers();
      const targets = all
        .filter(t => t.id !== sess.playerId || p.roleId === 'VETERAN')
        .map(t => ({ id: t.id, number: t.gameNumber, name: t.gameName }));
      const mafiaTargets = p.isMafiaAligned()
        ? targets.filter(t => !sess.game.getPlayer(t.id)?.isMafiaAligned()) : targets;
      playerSock.emit('night_prompt', {
        hasAction: p.role.nightAction,
        action: nightActionCode(p.roleId),
        desc: p.role.actionDescription,
        targets: p.isMafiaAligned() ? mafiaTargets : targets,
        allies: p.isMafiaAligned() ? mafiaAllyList(sess.game, sess.playerId) : [],
      });
    }
    sess._playerActed = false;
    sess._timer = setTimeout(() => soloProcessNight(sess), 40000);
  } else if (!sess.isTraining) {
    sess._timer = setTimeout(() => soloProcessNight(sess), 600);
  }
}

function soloAutoStart(sess, socket) {
  if (sess.game.phase !== 'WAITING') return;
  try { sess.game.assignRoles(); } catch (e) { socket?.emit('error_msg', e.message); return; }
  sess.game.phase = 'NIGHT';
  sess.game.dayNumber = 1;
  sess.game.addEvent('🎭 Игра началась! Роли розданы.');
  broadcastSolo(sess);
  if (sess.playerId && socket) {
    const ps = sess.game.playerState(sess.playerId);
    socket.emit('player_state', ps);
    socket.emit('role_reveal', ps?.role ?? null);
  }
  setTimeout(() => soloNight(sess), 2500);
}

app.post('/api/mafia/solo', express.json(), (req, res) => {
  const { playerName = 'Игрок', botCount = 7, mode = 'player' } = req.body;
  const isTraining = mode === 'training';
  const isHostMode = mode === 'host' || isTraining;
  const minBots = isHostMode ? 8 : 7;
  const bc = Math.max(minBots, Math.min(19, Number(botCount) || minBots));
  const sessionId = require('crypto').randomUUID();
  const game = new MafiaGame();

  let playerId = null;
  if (!isHostMode) {
    playerId = 'solo_' + require('crypto').randomBytes(4).toString('hex');
    game.registerPlayer(playerId, String(playerName).slice(0, 20), null);
  }

  const botNames = SOLO_BOT_NAMES.slice(0, bc);
  for (const name of botNames) game.registerPlayer(mkBotId(name), name, null);

  const sess = {
    sessionId, hostDiscordId: '__solo__', guildId: 'solo', chatChannelId: null,
    game, sockets: new Map(), isSolo: true, playerId,
    botIds: botNames.map(mkBotId), _timer: null, _playerActed: false, _started: false,
    isHostMode, isTraining,
  };
  mafiaSessions.set(sessionId, sess);
  setTimeout(() => { clearTimeout(sess._timer); mafiaSessions.delete(sessionId); }, 3 * 60 * 60 * 1000);
  if (!req.session.soloSessions) req.session.soloSessions = {};
  req.session.soloSessions[sessionId] = {
    playerId: playerId ?? '__observer__',
    playerName: isHostMode ? 'Ведущий' : String(playerName).slice(0, 20),
    isObserver: isHostMode,
  };
  req.session.save?.();
  res.json({ sessionId, playerId, playerName: isHostMode ? 'Ведущий' : playerName, isHostMode });
});

const soloIo = new SocketIO(httpServer, { path: '/solo-ws', cors: { origin: '*', credentials: true } });
soloIo.engine.use(sessionMiddleware);

soloIo.on('connection', (socket) => {
  const soloSessions = socket.request.session?.soloSessions ?? {};
  let sess = null, userId = null;

  socket.on('identify', ({ sessionId }) => {
    const info = soloSessions[sessionId];
    if (!info) { socket.emit('error_msg', 'Сессия не найдена.'); return; }
    sess = mafiaSessions.get(sessionId);
    if (!sess?.isSolo) { socket.emit('error_msg', 'Сессия не найдена.'); return; }
    userId = info.isObserver ? '__observer__' : info.playerId;
    if (sess.sockets.has(userId)) sess.sockets.get(userId).disconnect();
    sess.sockets.set(userId, socket);
    socket.emit('identified', { isHost: info.isObserver, userId, username: info.playerName });
    socket.emit('state', sess.game.publicState());
    if (info.isObserver) {
      socket.emit('host_state', sess.game.hostState());
    } else {
      const ps = sess.game.playerState(userId);
      if (ps) socket.emit('player_state', ps);
    }
    if (sess.game.phase === 'WAITING' && !sess._started) {
      sess._started = true;
      setTimeout(() => soloAutoStart(sess, info.isObserver ? null : socket), 1000);
    }
  });

  socket.on('disconnect', () => { if (sess && userId) sess.sockets.delete(userId); });

  socket.on('solo:host:kill', ({ targetId }) => {
    if (!sess?.isSolo || userId !== '__observer__') return;
    const p = sess.game.getPlayer(targetId);
    if (!p?.isAlive) return;
    p.isAlive = false;
    sess.game.addEvent(`⛔ ${p.gameName} выбыл по решению ведущего.`);
    const w = sess.game.checkWinner();
    if (w) { sess.game.phase = 'FINISHED'; sess.game.addEvent(`🏆 ${w}`); broadcastSolo(sess); return; }
    broadcastSolo(sess);
  });

  socket.on('solo:host:start_vote', () => {
    if (!sess?.isSolo || userId !== '__observer__') return;
    if (sess.game.phase !== 'DAY') return;
    clearTimeout(sess._timer);
    soloStartVoting(sess);
  });

  socket.on('solo:host:end_vote', () => {
    if (!sess?.isSolo || userId !== '__observer__') return;
    if (sess.game.phase !== 'VOTING') return;
    clearTimeout(sess._timer);
    soloEndVoting(sess);
  });

  socket.on('solo:host:night', () => {
    if (!sess?.isSolo || userId !== '__observer__') return;
    if (sess.game.phase !== 'DAY' && sess.game.phase !== 'VOTING') return;
    clearTimeout(sess._timer);
    soloNight(sess);
  });

  socket.on('player:night_action', ({ action, targetId }) => {
    if (!sess || sess.game.phase !== 'NIGHT' || sess._playerActed) return;
    const actor = sess.game.getPlayer(userId);
    if (!actor?.isAlive) return;
    const target = targetId ? sess.game.getPlayer(targetId) : null;

    if (action === 'skip') {
      actor.nightTarget = null;
      socket.emit('night_result', { text: 'Ты пропускаешь ход.' });
    } else if (action === 'k') {
      if (!target?.isAlive) return;
      sess.game.recordMafiaVote(actor, target);
      socket.emit('night_result', { text: `Твой голос: **${target.gameName}**.` });
    } else if (action === 'dc') {
      if (!target?.isAlive) return;
      socket.emit('night_result', { text: `**${target.gameName}**: ${target.roleId === 'COMMISSIONER' ? '+ Комиссар!' : '− не Комиссар'}` });
    } else if (action === 'c') {
      if (!target?.isAlive) return;
      sess.game.recordNightAction(actor, target);
      const hit = target.isDetectedByCommissioner();
      socket.emit('night_result', { text: `**${target.gameName}**: ${hit ? '+ Мафия/Маньяк' : '− Мирный'}`, isArrestAvailable: hit && sess.game.dayNumber === 1 });
    } else if (action === 'ck') {
      if (!target?.isAlive || !target.isMafiaAligned() || sess.game.dayNumber !== 1) return;
      actor.commissionerArrest = true;
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Арест оформлен — **${target.gameName}** будет задержан утром.` });
    } else if (action === 'h') {
      if (!target?.isAlive) return;
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Ты лечишь **${target.gameName}** этой ночью.` });
    } else if (action === 'b') {
      if (!target?.isAlive) return;
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Ты блокируешь **${target.gameName}** этой ночью.` });
    } else if (action === 'g') {
      if (!target?.isAlive || target.id === actor.id) return;
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Ты охраняешь **${target.gameName}** этой ночью.` });
    } else if (action === 'va') {
      sess.game.recordNightAction(actor, actor);
      socket.emit('night_result', { text: `Боевая готовность! Осталось: **${actor.veteranAlerts}**.` });
    } else if (action === 'm') {
      if (!target?.isAlive) return;
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Цель выбрана: **${target.gameName}**.` });
    } else if (action === 'wc') {
      if (!target?.isAlive) return;
      sess.game.recordNightAction(actor, target);
      socket.emit('night_result', { text: `Ты контролируешь **${target.gameName}** этой ночью.` });
    }

    sess._playerActed = true;
    clearTimeout(sess._timer);
    sess._timer = setTimeout(() => soloProcessNight(sess), 3000);
  });

  socket.on('player:vote', ({ targetId }) => {
    if (!sess || sess.game.phase !== 'VOTING') return;
    const voter = sess.game.getPlayer(userId);
    if (!voter?.isAlive) return;
    if (!targetId) {
      sess.game._votes.delete(userId);
      sess.game._weights.delete(userId);
      socket.emit('night_result', { text: 'Ты воздержался.' });
    } else {
      const target = sess.game.getPlayer(targetId);
      if (!target?.isAlive) return;
      const msg = sess.game.castVote(voter, target);
      socket.emit('night_result', { text: msg });
    }
    broadcastSolo(sess);
    clearTimeout(sess._timer);
    sess._timer = setTimeout(() => soloEndVoting(sess), 4000);
  });

  function requireTrainingHost() {
    return !!(sess?.isSolo && sess.isTraining && userId === '__observer__');
  }

  socket.on('solo:host:start', ({ rolePool } = {}) => {
    if (!requireTrainingHost()) return;
    if (sess.game.phase !== 'WAITING') { socket.emit('error_msg', 'Игра уже идёт.'); return; }

    if (Array.isArray(rolePool) && rolePool.length >= sess.game.players.size) {
      const ids = [...sess.game.players.keys()];
      for (let i = ids.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      ids.forEach((uid, idx) => {
        const p = sess.game.players.get(uid);
        p.role = ROLES[rolePool[idx]] || ROLES[RoleID.PEACEFUL];
        p.gameNumber = sess.game.playerNumbers.get(uid) ?? null;
      });
    } else {
      try { sess.game.assignRoles(); } catch (e) { socket.emit('error_msg', e.message); return; }
    }

    sess.game.phase = 'DAY';
    sess.game.dayNumber = 1;
    sess.game.addEvent('🎭 Игра началась! Роли розданы. День 1.');
    const maf = [...sess.game.players.values()].filter(p => p.isMafiaAligned());
    sess.game.addHostLog(`── Состав мафии ──\n${maf.map(p => `${p.role.emoji} ${p.gameName} — ${p.role.name}`).join('\n') || '—'}`);
    sess.game.addHostLog(`── Все роли ──\n${[...sess.game.players.values()].map(p => `[${p.gameNumber}] ${p.displayName} — ${p.role.emoji} ${p.role.name}`).join('\n')}`);
    broadcastSolo(sess);
  });

  socket.on('solo:host:day', () => {
    if (!requireTrainingHost()) return;
    if (sess.game.phase !== 'NIGHT') { socket.emit('error_msg', 'Нельзя.'); return; }
    clearTimeout(sess._timer);
    soloProcessNight(sess);
  });

  socket.on('solo:host:nominate', ({ targetId }) => {
    if (!requireTrainingHost()) return;
    if (sess.game.phase !== 'DAY') return;
    const p = sess.game.getPlayer(targetId);
    if (!p?.isAlive) return;
    if (sess.game._nominations.has(targetId)) sess.game._nominations.delete(targetId);
    else sess.game._nominations.add(targetId);
    broadcastSolo(sess);
  });

  socket.on('solo:host:vote_start', () => {
    if (!requireTrainingHost()) return;
    if (sess.game.phase !== 'DAY') { socket.emit('error_msg', 'Выставить можно только днём.'); return; }
    if (!sess.game._nominations.size) { socket.emit('error_msg', 'Никто не выставлен.'); return; }
    clearTimeout(sess._timer);
    sess.game._voteCandidates = new Set(sess.game._nominations);
    sess.game._nominations.clear();
    sess.game.resetVote();
    sess.game._voteOpen = true;
    sess.game.phase = 'VOTING';
    const names = [...sess.game._voteCandidates].map(id => sess.game.getPlayer(id)?.gameName ?? id).join(', ');
    sess.game.addEvent(`⚖️ Голосование! На вылет выставлены: ${names}`);
    broadcastSolo(sess);
    setTimeout(() => { botVotes(sess); broadcastSolo(sess); }, 1600);
  });

  socket.on('solo:host:foul', ({ targetId }) => {
    if (!requireTrainingHost()) return;
    const p = sess.game.getPlayer(targetId);
    if (!p?.isAlive) return;
    p.fouls = (p.fouls || 0) + 1;
    const f = p.fouls;
    sess.game.addHostLog(`⚠️ Фол #${f} → ${p.gameName}`);
    sess.game.addEvent(`⚠️ ${p.gameName} получает фол (${f}/4)`);
    if (f >= 4) {
      p.isAlive = false;
      sess.game.addEvent(`⛔ ${p.gameName} удалён за 4 фола.`);
      clearTimeout(sess._timer);
      const w = sess.game.checkWinner();
      if (w) { sess.game.phase = 'FINISHED'; sess.game.addEvent(`🏆 ${w}`); broadcastSolo(sess); return; }
    }
    broadcastSolo(sess);
  });

  socket.on('solo:host:end', () => {
    if (!requireTrainingHost()) return;
    clearTimeout(sess._timer);
    sess.game.phase = 'FINISHED';
    sess.game.addEvent('🛑 Игра остановлена ведущим.');
    broadcastSolo(sess);
  });
});

app.use((err, req, res, next) => {
    console.error('[route error]', req.method, req.path, '-', err?.message || err);
    if (!res.headersSent) res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

async function checkDatabases() {
    const checks = [
        ['modbot', db], ['eco', dbEco], ['economy', dbEconomy],
        ['clans', dbClans], ['giveaway', dbGiveaway], ['apps', dbApps],
    ];
    for (const [name, p] of checks) {
        try { await p.query('SELECT 1'); }
        catch (e) { console.warn(`mysql ${name}: ${e.code || e.message}`); }
    }
}

httpServer.listen(PORT, async () => {
    console.log(`listening on ${PORT}`);
    await checkDatabases();
    if (!process.env.DISCORD_CLIENT_SECRET) console.warn('DISCORD_CLIENT_SECRET is not set');
    if (!process.env.BOT_TOKEN) console.warn('BOT_TOKEN is not set');
});
