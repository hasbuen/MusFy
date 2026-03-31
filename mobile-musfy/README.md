# MusFy Mobile

Base do aplicativo Android do MusFy.

## Direcao tecnica

- Stack: Expo SDK 55 + React Native.
- Rede: consome o servidor MusFy na LAN pelo endereco configurado no app.
- Persistencia local: `expo-sqlite` guarda configuracoes, cache da biblioteca, cache de playlists e indice offline.
- Arquivos offline: `expo-file-system` salva cada faixa no armazenamento privado do app.
- Redis: continua no lado servidor para fila, estado e sincronizacao; o Android consulta esse estado via `/service/storage` e rotas da API.

## Primeiras telas

- `server`: configura URL do host MusFy e sincroniza biblioteca/playlists.
- `library`: lista faixas do servidor e baixa uma faixa para offline.
- `playlists`: lista playlists do servidor e baixa uma playlist inteira para offline.
- `offline`: mostra o que ja foi salvo no aparelho.

## Comandos

```bash
npm install
npx expo start
```

Para gerar APK interno depois:

```bash
npx eas build --platform android --profile preview
```

## Endpoints usados

- `GET /health`
- `GET /service/storage`
- `GET /enviar-musica?section=library`
- `GET /playlists`
- `POST /devices/register`
- `GET /download-musica/:id`

## Observacao

Esta etapa prepara a fundacao do APK. O proximo passo e conectar player nativo, login/sessao do usuario e fluxo de descoberta do servidor por QR/LAN.
