const SUPABASE_URL = process.env.SUPABASE_CAM_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_CAMERA_SERVICE_ROLE_KEY;

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Método não permitido." }); 
  }

  try {
    const authorization = req.headers.authorization || "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";

    if (!token) {
      return res.status(401).json({ error: "Faça login para consultar o acesso." });
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      console.error("ENV FALTANDO - URL:", !!SUPABASE_URL, "SERVICE_ROLE:", !!SUPABASE_SERVICE_ROLE_KEY);
      return res.status(500).json({ error: "Configuração do servidor incompleta." });
    }

    // Usa SÓ a SERVICE_ROLE para validar o token - não depende mais da publishable
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${token}`
      }
    });

    if (!authResponse.ok) {
      console.error("ERRO AUTH:", await authResponse.text());
      console.error("URL usada:", SUPABASE_URL);
      return res.status(401).json({ error: "Sessão inválida." });
    }

    const user = await authResponse.json();

    const accessResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/user_access?user_id=eq.${encodeURIComponent(user.id)}&select=*&order=expires_at.desc.nullslast&limit=1`,
      {
        headers: {
          apikey: SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
        }
      }
    );

    if (!accessResponse.ok) {
      return res.status(500).json({ error: "Não foi possível consultar o acesso." });
    }

    const rows = await accessResponse.json();
    const record = rows[0];

    let hasAccess = false;
    let expiresAt = null;
    let isLifetime = false;

    if (record) {
      isLifetime = record.lifetime_access === true;
      if (isLifetime) hasAccess = true;

      if (record.expires_at && new Date(record.expires_at).getTime() > Date.now()) {
        hasAccess = true;
      }

      if (record.paid_at) {
        const diffDays = (Date.now() - new Date(record.paid_at).getTime()) / 86400000;
        if (diffDays < 32) hasAccess = true;
      }

      expiresAt = record.expires_at
        ? new Date(record.expires_at).toISOString()
        : record.paid_at
          ? new Date(new Date(record.paid_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null;
    }

    // >>> CORREÇÃO TRIAL 24H - procura em assinaturas por trial OU active <<<
    if (!hasAccess && user.email) {
      const subResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/assinaturas?email=eq.${encodeURIComponent(user.email)}&select=*&order=expires_at.desc.nullslast&limit=5`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );
      if (subResponse.ok) {
        const subs = await subResponse.json();
        for (const sub of subs) {
          // aceita trial, active, ativo + pending como trial de 24h
          const st = (sub.status || '').toLowerCase();
          if (!['trial', 'active', 'ativo', 'paid', 'aprovado', 'pending'].includes(st)) continue;
          // aceita expires_at OU expira_em (suas duas colunas)
          // se for pending sem expiração, usa created_at + 24h
          let expRaw = sub.expires_at || sub.expira_em;
          if (!expRaw && st === 'pending') {
            const createdRaw = sub.created_at || sub.criado_em;
            if (createdRaw) expRaw = new Date(new Date(createdRaw).getTime() + 24 * 60 * 60 * 1000).toISOString();
          }
          if (expRaw && new Date(expRaw).getTime() > Date.now()) {
            hasAccess = true;
            expiresAt = new Date(expRaw).toISOString();
            break;
          }
        }
      }
    }

    return res.status(200).json({
      authenticated: true,
      hasLifetimeAccess: isLifetime,
      hasAccess: hasAccess,
      paidAt: record?.paid_at || null,
      expiresAt: expiresAt
    });

  } catch (error) {
    console.error("Erro access-status:", error.message);
    return res.status(500).json({ error: "Erro interno" });
  }
};
