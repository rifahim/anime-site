import fs from 'node:fs';
import path from 'node:path';
import WebTorrent from 'webtorrent';
import Parser from 'rss-parser';

const parser = new Parser();
const client = new WebTorrent();

export function initRssTorrentIngestion() {
  const mediaDir = path.join(process.cwd(), 'public', 'media');
  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  const rssUrl = process.env.MEDIA_RSS_URL;
  const magnetUrl = process.env.MEDIA_MAGNET_URL;

  // 1. Optional Magnet / Torrent Ingestion
  if (magnetUrl) {
    console.log('[Media Ingestion] Starting torrent download from magnet...');
    client.add(magnetUrl, { path: mediaDir }, (torrent) => {
      console.log(`[Media Ingestion] Downloading torrent: ${torrent.name}`);
      torrent.on('done', () => {
        console.log(`[Media Ingestion] Torrent download complete: ${torrent.name}`);
      });
      torrent.on('error', (err) => {
        console.error('[Media Ingestion] Torrent error:', err.message);
      });
    });
  }

  // 2. Optional RSS Feed Ingestion (checking for .mp4/.m3u8 enclosures or direct links)
  if (rssUrl) {
    setInterval(async () => {
      try {
        console.log(`[Media Ingestion] Checking RSS feed: ${rssUrl}`);
        const feed = await parser.parseURL(rssUrl);
        for (const item of (feed.items || [])) {
          const enclosure = item.enclosure?.url || item.link;
          if (enclosure && /\.(mp4|m3u8|webm|mov)$/i.test(enclosure)) {
            const fileName = path.basename(new URL(enclosure).pathname);
            const targetPath = path.join(mediaDir, fileName);
            if (!fs.existsSync(targetPath)) {
              console.log(`[Media Ingestion] Found new media in RSS: ${fileName}, downloading...`);
              // Fetch and save locally
              const res = await fetch(enclosure);
              if (res.ok) {
                const buffer = Buffer.from(await res.arrayBuffer());
                fs.writeFileSync(targetPath, buffer);
                console.log(`[Media Ingestion] Saved ${fileName} to public/media/`);
              }
            }
          }
        }
      } catch (err) {
        console.error('[Media Ingestion] RSS check failed:', err.message);
      }
    }, 30 * 60 * 1000); // Check every 30 minutes
  }
}
