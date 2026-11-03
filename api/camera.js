export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  const FTP_MAP = {
    'ptz_passo_fundo': 'Passo_Fundo',
    'Passo_Fundo': 'Passo_Fundo',
    'Serafina_Correa': 'Serafina_Correa',
    'Sananduva': 'Sananduva',
    'serafina_correa': 'Serafina_Correa',
    'sananduva': 'Sananduva',
  };

  try {
    let imageUrl;

    if (FTP_MAP[id]) {
      imageUrl = `https://daer.kopp.com.br/ftp/imagem.php?id=${FTP_MAP[id]}&t=${Date.now()}&r=${Math.random()}`;
    } else {
      const BASES = ['010','011','012','013'];
      for (const base of BASES) {
        try {
          const url = `https://daer.kopp.com.br/sistrak-base-${base}/rs/importacao/camera-importador-operacao-registro/codigo-camera/${id}?t=${Date.now()}`;
          const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
          if (r.ok) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 5000) {
              res.setHeader('Content-Type', 'image/jpeg');
              res.setHeader('Cache-Control', 'no-store, no-cache');
              return res.send(buf);
            }
          }
        } catch {}
      }
      if (id === 'ptz_caxias') {
        for (const base of BASES) {
          try {
            const url = `https://daer.kopp.com.br/sistrak-base-${base}/rs/importacao/camera-importador-operacao-registro/codigo-camera/ptz_caxias_do_sul?t=${Date.now()}`;
            const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
            if (r.ok) {
              const buf = Buffer.from(await r.arrayBuffer());
              if (buf.length > 5000) {
                res.setHeader('Content-Type', 'image/jpeg');
                res.setHeader('Cache-Control', 'no-store');
                return res.send(buf);
              }
            }
          } catch {}
        }
      }
      throw new Error('camera not found');
    }

    const r = await fetch(imageUrl, { headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' }, cache: 'no-store' });
    if (!r.ok) throw new Error('ftp failed ' + r.status);
    const buffer = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store, no-cache');
    return res.send(buffer);

  } catch (e) {
    return res.status(500).json({ error: e.message, id });
  }
}
