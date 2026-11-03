export default async function handler(req, res) {
  const cam = req.query.cam || 'ptz_santa_maria';
  
  let urls = [];
  
  if (cam === 'ptz_passo_fundo') {
    // tenta direto do DAER e se falhar, pega do seu daer-ao-vivo que já funciona
    urls = [
      'https://daer.kopp.com.br/ftp/imagem.php?id=Passo_Fundo',
      'https://daer.kopp.com.br/sistrak-base-010/rs/importacao/camera-importador-operacao-registro/codigo-camera/ptz_passo_fundo',
      'https://daer-ao-vivo.vercel.app/camera.php?cam=ptz_passo_fundo'
    ];
  } else if (cam === 'ptz_caxias_do_sul') {
    urls = [
      `https://daer.kopp.com.br/sistrak-base-010/rs/importacao/camera-importador-operacao-registro/codigo-camera/${cam}`,
      'https://daer.kopp.com.br/sistrak-base-010/rs/importacao/camera-importador-operacao-registro/codigo-camera/ptz_caxias',
      'https://daer-ao-vivo.vercel.app/camera.php?cam=ptz_caxias_do_sul'
    ];
  } else {
    urls = [`https://daer.kopp.com.br/sistrak-base-010/rs/importacao/camera-importador-operacao-registro/codigo-camera/${cam}`];
  }

  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'Referer': 'https://www.daer.rs.gov.br/cameras-de-monitoramento',
          'User-Agent': 'Mozilla/5.0'
        }
      });
      if (r.ok) {
        const buffer = Buffer.from(await r.arrayBuffer());
        if (buffer.length > 5000) {
          res.setHeader('Content-Type', 'image/jpeg');
          res.setHeader('Cache-Control', 'no-store');
          return res.send(buffer);
        }
      }
    } catch (e) {}
  }
  res.status(500).send('erro camera ' + cam);
}
