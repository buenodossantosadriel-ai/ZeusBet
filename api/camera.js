export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).send('sem id');

  const url = `https://daer.kopp.com.br/sistrak-base-010/imagemtrafegov2/imagem?codigo=${id}&t=${Date.now()}`;

  try {
    const r = await fetch(url, {
      headers: {
        'Referer': 'https://daer.kopp.com.br/',
        'User-Agent': 'Mozilla/5.0',
      }
    });

    if (!r.ok) return res.status(502).send('erro kopp ' + r.status);

    const buf = await r.arrayBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(500).send(e.message);
  }
}
