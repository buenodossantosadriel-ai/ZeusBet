import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://gtgjxojobbljrvwppfzi.supabase.co'
const SUPABASE_ANON = 'sb_publishable_M91qcsHQee_BH4qvIn2oJA_oLKWpY--'

export default async function handler(req, res) {
  // 1. Verifica login
  const auth = req.headers.authorization
  if (!auth) {
    return res.status(401).send('precisa logar')
  }
  const token = auth.replace('Bearer ', '')

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  })

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return res.status(401).send('sessao expirou')
  }

  // 2. Verifica se pagou R$20 vitalício (usa a mesma lógica do seu access-status)
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/payments?user_id=eq.${user.id}&status=eq.approved&select=id`, {
      headers: {
        'apikey': SUPABASE_ANON,
        'Authorization': `Bearer ${token}`
      }
    })
    // Se você usa outra tabela (ex: profiles com has_lifetime), me fala que eu ajusto
    // Essa verificação também pode ser via seu /api/access-status
    const payments = await r.json()
    if (!payments || payments.length === 0) {
      // tenta checar pelo seu endpoint de acesso
      const check = await fetch(`${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}/api/access-status`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      const j = await check.json()
      if (!j.hasLifetimeAccess) {
        return res.status(403).send('acesso nao liberado - pague R$20')
      }
    }
  } catch (e) {
    // se falhar a checagem, bloqueia por segurança
    return res.status(403).send('sem acesso')
  }

  // 3. Se passou, libera a imagem (seu código original)
  const cam = req.query.cam || 'ptz_santa_maria';
  let url;
  if (cam === 'ptz_passo_fundo') {
    url = 'https://daer.kopp.com.br/ftp/imagem.php?id=Passo_Fundo';
  } else {
    url = `https://daer.kopp.com.br/sistrak-base-010/rs/importacao/camera-importador-operacao-registro/codigo-camera/${cam}`;
  }
  try {
    const r2 = await fetch(url, {
      headers: {
        'Referer': 'https://www.daer.rs.gov.br/cameras-de-monitoramento',
        'User-Agent': 'Mozilla/5.0'
      }
    });
    const buffer = Buffer.from(await r2.arrayBuffer());
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (e) {
    res.status(500).send('erro camera');
  }
}
