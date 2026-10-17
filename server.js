import express from 'express';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode';
import QRCodeTerminal from 'qrcode-terminal';

// ================= CONFIG =================
const PORT = process.env.PORT || 10000;
const TARGET = '6281234567890'; // GANTI DENGAN NOMOR TARGET BOS
const MESSAGE = 'Halo, ini pesan dari Rei.'; // GANTI DENGAN PESAN
const JUMLAH = 1; // BERAPA KALI KIRIM
const DELAY_MS = 2000; // JEDA ANTAR KIRIM (ms)
// ==========================================

const app = express();
let latestQR = null;
let status = 'starting';

app.get('/', (req, res) => {
  res.json({ status, qr: latestQR ? '/qr' : null });
});

app.get('/qr', async (req, res) => {
  if (!latestQR) return res.send('QR belum tersedia. Tunggu atau restart service.');
  const dataUrl = await qrcode.toDataURL(latestQR);
  res.send(`<html><body style="background:#111;color:#eee;font-family:sans-serif;text-align:center;padding:40px">
    <h2>Scan QR ini di WhatsApp</h2>
    <img src="${dataUrl}" style="background:#fff;padding:16px;border-radius:8px"/>
    <p>WhatsApp > Perangkat Tertaut > Tautkan Perangkat</p>
  </body></html>`);
});

app.listen(PORT, () => console.log(`Server jalan di port ${PORT}`));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeJid(raw) {
  let n = String(raw).replace(/[^\d]/g, '');
  if (n.startsWith('0')) n = '62' + n.slice(1);
  if (n.startsWith('8')) n = '62' + n;
  if (!n.startsWith('62')) n = '62' + n;
  return n + '@s.whatsapp.net';
}

async function start() {
  if (!TARGET) {
    console.error('TARGET belum diisi');
    process.exit(1);
  }

  const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Rei', 'Chrome', '1.0.0'],
    markOnlineOnConnect: false
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      latestQR = qr;
      status = 'need_scan';
      QRCodeTerminal.generate(qr, { small: true });
      console.log('QR tersedia. Buka /qr di browser.');
    }

    if (connection === 'close') {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.log('Koneksi tertutup. Reconnect:', reconnect);
      if (reconnect) {
        start();
      } else {
        console.log('Logged out. Hapus auth_info_baileys lalu redeploy.');
        process.exit(0);
      }
    }

    if (connection === 'open') {
      status = 'connected';
      latestQR = null;
      console.log('Terhubung ke WhatsApp.');

      const jid = normalizeJid(TARGET);
      const [result] = await sock.onWhatsApp(jid);
      if (!result?.exists) {
        console.log('Nomor tidak terdaftar:', jid);
        return;
      }

      console.log(`Target: ${result.jid}`);
      console.log(`Kirim ${JUMLAH} pesan, delay ${DELAY_MS}ms`);

      let sent = 0;
      for (let i = 0; i < JUMLAH; i++) {
        try {
          const msg = await sock.sendMessage(result.jid, { text: MESSAGE });
          sent++;
          console.log(`[${sent}/${JUMLAH}] Terkirim. ID: ${msg.key.id}`);
        } catch (e) {
          console.log(`[${i + 1}/${JUMLAH}] Gagal: ${e.message}`);
        }
        if (i < JUMLAH - 1) await sleep(DELAY_MS);
      }

      console.log(`Selesai. Terkirim: ${sent}/${JUMLAH}`);
    }
  });
}

start();