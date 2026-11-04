const { randomUUID } = require("crypto");

const SUPABASE_URL =
  process.env.ZEUS_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL;

const SUPABASE_ANON_KEY =
  process.env.ZEUS_SUPABASE_PUBLISHABLE_KEY ||
  process.env.ZEUS_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const SUPABASE_SERVICE_ROLE_KEY =
  process.env.ZEUS_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.ZEUS_SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY;

// AGORA ACEITA QUALQUER NOME QUE VOCÊ CRIAR NA VERCEL
const MERCADOPAGO_ACCESS_TOKEN =
  process.env.MERCADOPAGO_ACCESS_TOKEN ||
  process.env.ZEUS_MERCADOPAGO_ACCESS_TOKEN ||
  process.env.ZEUS_MERCADOPAGO_ACCESS_TOKEN_PROD ||
  process.env.MP_ACCESS_TOKEN ||
  process.env.ZEUS_MP_ACCESS_TOKEN;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Faltando env Supabase");
    return res.status(500).json({ error: "Configuração Supabase incompleta." });
  }

  if (!MERCADOPAGO_ACCESS_TOKEN) {
    console.error("Faltando MERCADOPAGO_ACCESS_TOKEN");
    return res.status(500).json({ error: "Token Mercado Pago não configurado na Vercel." });
  }

  if (!MERCADOPAGO_ACCESS_TOKEN.startsWith("APP_USR-")) {
    console.error("Token MP inválido:", MERCADOPAGO_ACCESS_TOKEN.slice(0,10));
    return res.status(500).json({ error: "Token MP inválido - tem que ser APP_USR-..." });
  }

  try {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

    if (!token) {
      return res.status(401).json({ error: "Faça login para continuar." });
    }

    // Valida o token no Supabase
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
    });

    if (!authResponse.ok) {
      const detalhe = await authResponse.text();
      console.error("Falha auth Supabase:", authResponse.status, detalhe);
      return res.status(401).json({ error: "Sessão inválida. Entre novamente." });
    }

    const user = await authResponse.json();

    if (!user.id || !user.email) {
      return res.status(401).json({ error: "Sessão inválida. Entre novamente." });
    }

    if (!user.email_confirmed_at) {
      return res.status(403).json({ error: "Confirme seu e-mail antes de continuar." });
    }

    // Consulta se já tem acesso - NÃO BLOQUEIA SE A TABELA NÃO EXISTIR
    try {
      const accessResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/user_access?user_id=eq.${encodeURIComponent(user.id)}&select=lifetime_access&limit=1`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
        }
      );
      if (accessResponse.ok) {
        const rows = await accessResponse.json();
        // Se quiser bloquear quem já tem acesso, descomenta:
        // if (rows?.[0]?.lifetime_access) return res.status(400).json({ error: "Você já tem acesso liberado." });
      }
    } catch (e) {
      console.warn("Tabela user_access não encontrada, ignorando:", e.message);
    }

    // Cria Pix no MP
    const paymentResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": randomUUID(),
      },
      body: JSON.stringify({
        transaction_amount: 19.9,
        description: "ZeusBet - 13 Câmeras RS - Acesso 30 dias",
        payment_method_id: "pix",
        payer: { email: user.email },
        external_reference: user.id,
        notification_url: "https://rodovias-rs-ao-vivo.vercel.app/api/mercadopago-webhook",
      }),
    });

    const payment = await paymentResponse.json();

    if (!paymentResponse.ok) {
      console.error("MP recusou:", JSON.stringify(payment));
      return res.status(502).json({ 
        error: payment.message || "Mercado Pago recusou. Verifique seu token APP_USR-.",
        detalhe: payment 
      });
    }

    const transaction = payment.point_of_interaction?.transaction_data;

    if (!transaction?.qr_code || !transaction?.qr_code_base64) {
      console.error("Sem QR Code:", JSON.stringify(payment));
      return res.status(502).json({ error: "MP não retornou QR Code. Tente novamente." });
    }

    return res.status(200).json({
      payment_id: payment.id,
      status: payment.status,
      amount: payment.transaction_amount,
      qr_code: transaction.qr_code,
      qr_code_base64: transaction.qr_code_base64,
      ticket_url: transaction.ticket_url,
    });
  } catch (error) {
    console.error("Erro interno create-payment:", error);
    return res.status(500).json({ error: "Erro interno ao preparar pagamento: " + error.message });
  }
};
