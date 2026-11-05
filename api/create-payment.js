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
    const userId = body.user_id || email

    // --- AGORA CRIA ORDER, NÃO PAYMENT ---
    const mpRes = await fetch('https://api.mercadopago.com/v1/orders', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'X-Idempotency-Key': `zeus-order-${userId}-${Date.now()}`
      },
      body: JSON.stringify({
        type: 'online',
        processing_mode: 'automatic',
        total_amount: '19.90',
        external_reference: userId,
        description: 'ZeusBet Acesso 30 dias',
        payer: {
          email: email,
          first_name: 'Cliente',
          last_name: 'ZeusBet'
        },
        transactions: {
          payments: [
            {
              amount: '19.90',
              payment_method: {
                id: 'pix',
                type: 'bank_transfer'
              }
            }
          ]
        }
      })
    })

    const mpData = await mpRes.json()

    if (!mpRes.ok) {
      return res.status(200).json({
        qr_code: "ERRO MP ORDER: " + JSON.stringify(mpData).substring(0, 800),
        qr_code_base64: "",
        token_tipo: token.substring(0, 7)
      })
    }

    // Acha o QR onde ele vier no retorno da Order
    function findKey(obj, keys) {
      if (!obj || typeof obj !== 'object') return null
      for (const k of keys) {
        if (obj[k]) return obj[k]
      }
      for (const v of Object.values(obj)) {
        const r = findKey(v, keys)
        if (r) return r
      }
      return null
    }

    const qr_code = findKey(mpData, ['qr_code', 'qrCode', 'pix_qr_code'])
    const qr_code_base64 = findKey(mpData, ['qr_code_base64', 'qrCodeBase64'])

    return res.status(200).json({
      id: mpData.id,
      status: mpData.status,
      qr_code: qr_code || "",
      qr_code_base64: qr_code_base64 || "",
    })

  } catch (e) {
    return res.status(200).json({ qr_code: "ERRO CATCH: " + e?.message, qr_code_base64: "" })
  }
}
