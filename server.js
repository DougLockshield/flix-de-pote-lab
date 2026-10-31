import { networkInterfaces } from 'node:os';
import { startServer } from './src/app.js';
import { HOST, PORT } from './src/config.js';

const { server } = startServer();

function lanUrls(port) {
  const urls = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      urls.push(`http://${entry.address}:${port}`);
    }
  }
  return urls;
}

server.on('listening', () => {
  if (HOST === '0.0.0.0') {
    console.log(`Flix de Pote disponível na rede local, porta ${PORT}`);
    for (const url of lanUrls(PORT)) console.log(url);
    return;
  }
  console.log(`Flix de Pote disponível em http://${HOST}:${PORT}`);
});

server.on('error', (error) => {
  console.error(`Não foi possível iniciar o Flix de Pote: ${error.message}`);
  process.exitCode = 1;
});
