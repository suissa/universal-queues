// src/handlers/outbox.ts

import fs from 'fs/promises';
const OUTBOX_PATH = './outbox-events.json';

export async function saveToOutbox(event: object) {
  let outbox: object[] = [];
  try {
    const file = await fs.readFile(OUTBOX_PATH, 'utf-8');
    outbox = JSON.parse(file);
  } catch (e) { /* arquivo não existe ou está vazio */ }
  outbox.push(event);
  await fs.writeFile(OUTBOX_PATH, JSON.stringify(outbox, null, 2));
}

export async function processOutbox(sendFn: (event: object) => Promise<void>) {
  try {
    const file = await fs.readFile(OUTBOX_PATH, 'utf-8');
    const outbox: object[] = JSON.parse(file);
    for (const event of outbox) {
      try {
        await sendFn(event);
        // Se enviado com sucesso, pode remover ou marcar como enviado
      } catch (e) {
        // log de erro, mantém no outbox para próxima tentativa
      }
    }
    // Após processar, zere o arquivo (ou use lógica mais robusta de update)
    await fs.writeFile(OUTBOX_PATH, '[]');
  } catch (e) {
    // nada a processar
  }
}
