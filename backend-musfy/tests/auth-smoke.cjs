const fs = require('fs');
const os = require('os');
const path = require('path');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'musfy-auth-'));

process.env.MUSFY_DATA_DIR = tempRoot;
process.env.PORT = '31987';
process.env.HOST = '127.0.0.1';

const { startServer, stopServer } = require('../server.js');

async function post(route, body) {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const json = await response.json();

  if (!response.ok) {
    throw new Error(`${route} failed ${response.status}: ${JSON.stringify(json)}`);
  }

  return json;
}

async function run() {
  startServer();
  await new Promise((resolve) => setTimeout(resolve, 250));

  const created = await post('/auth/register', {
    nome: 'Julio',
    login: 'Julio',
    senha: '123'
  });

  if (!created.usuario?.id) {
    throw new Error(`register did not return a user: ${JSON.stringify(created)}`);
  }

  if (created.usuario.login !== 'julio' || created.usuario.email !== null) {
    throw new Error(`plain login was not normalized safely: ${JSON.stringify(created)}`);
  }

  const logged = await post('/auth/login', {
    login: 'Julio',
    senha: '123'
  });

  if (logged.usuario.id !== created.usuario.id) {
    throw new Error('login by username did not return the created user');
  }

  const emailUser = await post('/auth/register', {
    nome: 'Ana',
    login: 'ana@example.com',
    email: 'ana@example.com',
    senha: 'abc'
  });

  const emailLogin = await post('/auth/login', {
    email: 'ana@example.com',
    senha: 'abc'
  });

  if (emailLogin.usuario.id !== emailUser.usuario.id) {
    throw new Error('login by email did not return the created user');
  }

  const legacy = await post('/usuarios', {
    nome: 'Maria',
    email: 'maria'
  });

  const recovered = await post('/auth/register', {
    nome: 'Maria',
    login: 'maria',
    senha: 'abc'
  });

  if (recovered.usuario.id !== legacy.usuario.id) {
    throw new Error('legacy user without password was not recovered');
  }

  const legacyLogin = await post('/auth/login', {
    login: 'maria',
    senha: 'abc'
  });

  if (legacyLogin.usuario.id !== legacy.usuario.id) {
    throw new Error('legacy login failed after password setup');
  }
}

run()
  .then(() => {
    console.log('auth smoke passed');
  })
  .finally(async () => {
    await stopServer();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
