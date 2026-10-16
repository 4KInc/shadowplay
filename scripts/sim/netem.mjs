// Network impairment relay: listen on `from`, forward to `to`, adding one-way delay and jitter
// to every chunk (order kept, like TCP), and cut all connections on demand (a dropout).
// Control: GET http://localhost:<ctl>/set?delay=250&jitter=80   GET /drop   GET /stats
import net from 'node:net';
import http from 'node:http';

export function startNetem({ from, to, ctl }) {
  const cfg = { delay: 0, jitter: 0 };
  const open = new Set();
  let bytes = 0;
  const pipe = (src, dst) => {
    let last = 0;
    src.on('data', (chunk) => {
      bytes += chunk.length;
      const wait = cfg.delay + (Math.random() * 2 - 1) * cfg.jitter;
      // Never overtake an earlier chunk.
      const at = Math.max(Date.now() + Math.max(0, wait), last);
      last = at;
      setTimeout(() => dst.writable && dst.write(chunk), Math.max(0, at - Date.now()));
    });
  };
  const server = net.createServer((c) => {
    const s = net.connect(to, '127.0.0.1');
    pipe(c, s); pipe(s, c);
    const pair = [c, s];
    open.add(pair);
    const end = () => { open.delete(pair); c.destroy(); s.destroy(); };
    for (const x of pair) { x.on('error', end); x.on('close', end); }
  }).listen(from);
  const control = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/set') {
      cfg.delay = Number(url.searchParams.get('delay') ?? 0);
      cfg.jitter = Number(url.searchParams.get('jitter') ?? 0);
    } else if (url.pathname === '/drop') {
      for (const [c, s] of open) { c.destroy(); s.destroy(); }
      open.clear();
    }
    res.end(JSON.stringify({ ...cfg, connections: open.size, bytes }));
  }).listen(ctl);
  return {
    set: (delay, jitter) => Object.assign(cfg, { delay, jitter }),
    drop: () => { for (const [c, s] of open) { c.destroy(); s.destroy(); } open.clear(); },
    close: () => { server.close(); control.close(); for (const [c, s] of open) { c.destroy(); s.destroy(); } },
  };
}
