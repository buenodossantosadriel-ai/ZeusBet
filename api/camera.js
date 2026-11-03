export default async function handler(req, res) {
  const cam = req.query.cam || 'ptz_santa_maria';
  let url;
  if (cam === 'ptz_passo_fundo') {
    url = 'https://daer.kopp.com.br/ftp/imagem.php?id=Passo_Fundo';
  } else {
    url = `https://daer.kopp.com.br/sistrak-base-010/rs/importacao/camera-importador-operacao-registro/codigo-camera/${cam}`;
  }
  try {
    const r = await fetch(url, {
      headers: {
        'Referer': 'https://www.daer.rs.gov.br/cameras-de-monitoramento',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    const buffer = Buffer.from(await r.arrayBuffer());
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (e) {
    res.status(500).send('erro camera');
  }
}
