export default async function handler(req: any, res: any) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST' })

  try {
    const token = process.env.MERCADOPAGO_ACCESS_TOKEN
    if (!token) {
      return res.status(500).json({ error: 'Falta MERCADOPAGO_ACCESS_TOKEN na Vercel' })
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const auth = req.headers.authorization || ''
    
    console.log('Criando pagamento...')

    const mpRes = await fetch('https://api.mercadopago.com/v1/payments', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `zeus-${Date.now()}`
      },
      body: JSON.stringify({
        transaction_amount: 19.9,
        description: 'ZeusBet Lifetime',
        payment_method_id: 'pix',
        payer: { email: 'cliente@teste.com', first_name: 'Cliente' },
        external_reference: 'zeusbet-teste'
      })
    })

    const mpData = await mpRes.json()
    console.log('Resposta MP:', JSON.stringify(mpData).slice(0, 1000))

    if (!mpRes.ok) {
      return res.status(400).json({ mp_error: mpData, dica: 'Se for collector same as payer, use email diferente do MP' })
    }

    return res.status(200).json({
      id: mpData.id,
      status: mpData.status,
      qr_code: mpData.point_of_interaction?.transaction_data?.qr_code,
      qr_code_base64: mpData.point_of_interaction?.transaction_data?.qr_code_base64,
    })

  } catch (e: any) {
    console.log('ERRO FATAL:', e?.message, e?.stack)
    return res.status(500).json({ error: 'Erro interno', details: e?.message })
  }
}
