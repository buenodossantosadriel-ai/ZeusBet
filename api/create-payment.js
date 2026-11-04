export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })

  try {
    const token = process.env.MP_TOKEN
    if (!token) return res.status(500).json({ error: 'Falta token na Vercel' })

    const body = req.body || {}
    const email = body.email || `cliente${Date.now()}@gmail.com`

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `zeus-${Date.now()}`
      },
      body: JSON.stringify({
        transaction_amount: 19.9,
        description: 'ZeusBet Acesso 30 dias',
        payment_method_id: 'pix',
        payer: {
          email: email,
          first_name: 'Cliente',
          last_name: 'ZeusBet'
        },
        external_reference: body.user_id || email
      })
    })

    const mpData = await mpRes.json()

    if (!mpRes.ok) {
      return res.status(200).json({ 
        qr_code: "ERRO MP: " + JSON.stringify(mpData).substring(0,800), 
        qr_code_base64: "", 
        token_tipo: token.substring(0,7) 
      })
    }

    return res.status(200).json({
      id: mpData.id,
      status: mpData.status,
      qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
    })

  } catch (e) {
    return res.status(200).json({ qr_code: "ERRO CATCH: " + e?.message, qr_code_base64: "" })
  }
}
