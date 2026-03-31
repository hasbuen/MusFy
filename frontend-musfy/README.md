# MusFy Desktop

MusFy usa duas responsabilidades:

- `MusFy Local Service`: backend local responsavel por downloads, biblioteca, conversao, streaming e API HTTP.
- `MusFy Desktop Player`: cliente Electron com tray, mini player e controle do dispositivo.

O pacote final para Windows nao depende de Node, Python ou FFmpeg instalados na maquina do usuario. O runtime e os binarios necessarios vao dentro do app.

## Desenvolvimento

- O Electron tenta iniciar o servico local automaticamente.
- O backend continua disponivel na porta `3001`.
- Clientes na rede local podem acessar `http://<ip-da-maquina>:3001`.
- Os dados e arquivos do MusFy ficam em `%ProgramData%\MusFy`, nao na pasta de instalacao.

## Servico do Windows

O instalador Windows registra automaticamente o `MusFyHostService` no SCM. Esse servico usa um host nativo do proprio app para subir o backend MusFy em modo headless, sobe no boot e e removido no uninstall.

O argumento continua existindo para debug manual:

```powershell
$env:MUSFY_SERVICE_BOOT="1"
"C:\Program Files\MusFy\MusFy.exe"
```

## Release no GitHub

Para publicar a atualizacao desktop no GitHub Releases, use o script abaixo em vez de `electron-builder --publish always`:

```powershell
$env:GH_TOKEN="<token-com-permissao-em-releases>"
npm run release:github -- --version 1.2.3
```

Regras do fluxo:

- A versao precisa ser semver real. `0.0.0` e bloqueado de proposito porque quebra tag e auto update.
- O script gera `latest.yml`, `MusFy.exe` e `MusFy.exe.blockmap`, cria ou atualiza o release `v<versao>` e reenvia os assets com overwrite seguro.
- Se quiser apenas validar o build antes do upload, rode `npm run release:github:build-only -- --version 1.2.3`.
