export default async function handler(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id required' });

  // Lista de bases pra tentar - porque você não me mandou o link de todas
  const BASES = ['010', '011', '012', '013', '014'];
  
  // Mapeamento de IDs alternativos que o DAER usa
  const ALT_IDS = {
    'ptz_caxias': ['ptz_caxias', 'ptz_caxias_do_sul'],
    'ptz_caxias_do_sul': ['ptz_caxias_do_sul', 'ptz_caxias'],
    'Serafina_Correa': ['Serafina_Correa', 'serafina_correa'],
    'Sananduva': ['Sananduva', 'sananduva'],
  };

  const tryIds = ALT_IDS[id] || [id];
  
  // 1. Se for tipo FTP (as 3 PHP)
  const isFTP = ['Passo_Fundo', 'Serafina_Correa', 'Sananduva', 'ptz_passo_fundo', 'ptz_passo'].some(x => id.toLowerCase().includes(x.toLowerCase().replace('ptz_',''))) || id.toLowerCase().includes('serafina') || id.toLowerCase().includes('sananduva');

  if (isFTP) {
    // Tenta FTP direto
    for (const tryId of tryIds) {
      const cleanId = tryId.replace('ptz_', '');
      // Tenta com primeira letra maiúscula igual você mandou
      const ftpIds = [cleanId, cleanId.charAt(0).toUpperCase() + cleanId.slice(1), tryId];
      for (const fId of ftpIds) {
        try {
          const url = `https://daer.kopp.com.br/ftp/imagem.php?id=${fId}&t=${Date.now()}`;
          const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
          if (r.ok && r.headers.get('content-type')?.includes('image')) {
            const buf = Buffer.from(await r.arrayBuffer());
            if (buf.length > 5000) { // é imagem de verdade
              res.setHeader('Content-Type', 'image/jpeg');
              res.setHeader('Cache-Control', 'no-store');
              return res.send(buf);
            }
          }
        } catch {}
      }
    }
  }

  // 2. Tenta SISTRAK em todas as bases
  for (const base of BASES) {
    for (const tryId of tryIds) {
      try {
        const url = `https://daer.kopp.com.br/sistrak-base-${base}/rs/importacao/camera-importador-operacao-registro/codigo-camera/${tryId}?t=${Date.now()}`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          // Se retornou imagem (>5kb) e não é JSON de erro
          if (buf.length > 5000) {
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(buf);
          }
        }
      } catch {}
    }
  }

  return res.status(404).json({ error: `camera ${id} not found in any base` });
}
