# Talori — сайт

Сайт Discord-сервера Talori: профили, кланы, стафф, наказания, ивенты, топы, мафия и покер в браузере.

Express 5, MySQL, Socket.IO, вход через Discord OAuth2.

## Запуск

```bash
npm install
cp .env.example .env
npm start
```

Сайт читает базы `modbot`, `eco`, `economy`, `clans`, `giveaway`, `apps`, которые наполняют боты сервера. Если базы нет, соответствующий раздел просто пустой.

На сервере: `bash deploy.sh` создаёт базы, ставит зависимости и поднимает сайт через PM2.
