# MusFy

Desktop player for Windows with local library, YouTube downloads, mini player, tray mode, offline playback, and GitHub-powered updates.

[Baixar a ultima release](https://github.com/hasbuen/Projects/releases/latest)  
[Abrir landing page](https://hasbuen.github.io/Projects/)  
[Instalador Windows](https://github.com/hasbuen/Projects/releases/latest/download/MusFy-Setup.exe)  
[APK Android](https://github.com/hasbuen/Projects/releases/latest/download/MusFy-Android.apk)

## O que o MusFy entrega

- Biblioteca local com playlists, favoritos e sessoes por usuario.
- Video, fullscreen e mini player sincronizados sem perder o estado da reproducao.
- Modo bandeja para continuar tocando com a interface oculta.
- Fluxo offline para salvar faixas e manter o player pronto.
- Auto update via GitHub Releases com notas da versao dentro do app.

## Experiencia do produto

MusFy foi pensado para ficar aberto o dia inteiro. A proposta e simples: abrir rapido, tocar rapido, esconder quando precisar e voltar exatamente ao ponto em que voce estava, sem virar uma interface pesada ou confusa.

## Estrutura do repositorio

- `frontend-musfy`: desktop app em Electron + React.
- `backend-musfy`: host local e servicos de midia.
- `mobile-musfy`: workspace do cliente mobile.
- `musfy-update-host`: landing page e assets usados no GitHub Pages.

## Distribuicao

- Releases: `latest.yml`, `MusFy-Setup.exe`, `MusFy-Setup.exe.blockmap` e `MusFy-Android.apk` publicados no GitHub Releases.
- Landing page: publicada via GitHub Pages a partir de `musfy-update-host/public`.
- Notas da versao: arquivos em `frontend-musfy/release-notes`.

## Status atual

O repositorio ainda aparece como `Projects` no GitHub por falta de permissao administrativa no token usado para automacao, mas a marca, o app e a landing page ja estao alinhados como MusFy.
