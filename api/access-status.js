const SUPABASE_URL = process.env.SUPABASE_CAM_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_CAMERA_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_CAM_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

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

    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`
      }
    });

    if (!authResponse.ok) {
      console.error("ERRO AUTH:", await authResponse.text());
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

    if (!record) {
      return res.status(200).json({ authenticated: true, hasLifetimeAccess: false, hasAccess: false, paidAt: null, expiresAt: null });
    }

    const isLifetime = record.lifetime_access === true;

    let hasAccess = false;
    if (isLifetime) hasAccess = true;

    if (record.expires_at && new Date(record.expires_at).getTime() > Date.now()) {
      hasAccess = true;
    }

    if (record.paid_at) {
      const diffDays = (Date.now() - new Date(record.paid_at).getTime()) / 86400000;
      if (diffDays < 32) hasAccess = true;
    }

    let expiresAt = record.expires_at
      ? new Date(record.expires_at).toISOString()
      : record.paid_at
        ? new Date(new Date(record.paid_at).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString()
        : null;

    if (!hasAccess && user.email) {
      const subResponse = await fetch(
        `${SUPABASE_URL}/rest/v1/assinaturas?email=eq.${encodeURIComponent(user.email)}&status=eq.active&select=*&order=expira_em.desc&limit=1`,
        {
          headers: {
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
          }
        }
      );
      if (subResponse.ok) {
        const subs = await subResponse.json();
        const sub = subs[0];
        if (sub && sub.expira_em && new Date(sub.expira_em).getTime() > Date.now()) {
          hasAccess = true;
          expiresAt = new Date(sub.expira_em).toISOString();
        }
      }
    }

    return res.status(200).json({
      authenticated: true,
      hasLifetimeAccess: isLifetime,
      hasAccess: hasAccess,
      paidAt: record.paid_at || null,
      expiresAt: expiresAt
    });

  } catch (error) {
    console.error("Erro access-status:", error.message);
    return res.status(500).json({ error: "Erro interno" });
  }
};
