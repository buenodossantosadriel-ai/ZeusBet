const SUPABASE_URL = (process.env.SUPABASE_CAM_URL || process.env.SUPABASE_URL || "").replace(/\/$/, "");
// Mesma chave pública usada pelo cliente Supabase do index.html.
// A chave é pública; a autorização de leitura é feita pelo JWT do próprio usuário e pela RLS.
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_M91qcsHQee_BH4qvIn2oJA_oLKWpY--";
// Mantida apenas para a consulta administrativa de assinaturas de teste (trial).
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_CAMERA_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

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

    if (!SUPABASE_URL) {
      console.error("ENV FALTANDO - URL do Supabase");
      return res.status(500).json({ error: "Configuração do servidor incompleta." });
    }

    // Valida a sessão usando a chave pública do mesmo projeto e o JWT do usuário.
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${token}`
      }
    });

    if (!authResponse.ok) {
      console.error("ERRO AUTH:", authResponse.status, await authResponse.text());
      return res.status(401).json({ error: "Sessão inválida." });
    }

    const user = await authResponse.json();

    // Consulta a linha do próprio usuário com o JWT dele.
    // A política RLS de user_access permite SELECT quando auth.uid() = user_id.
    // Assim, a validação não depende de uma service_role incorreta ou de RLS desativada.
    const accessResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/user_access?user_id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`,
      {
        headers: {
          apikey: SUPABASE_PUBLISHABLE_KEY,
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (!accessResponse.ok) {
      console.error("ERRO USER_ACCESS:", accessResponse.status, await accessResponse.text());
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

      const effectiveExpiry = record.expires_at
        ? new Date(record.expires_at)
        : record.paid_at
          ? new Date(new Date(record.paid_at).getTime() + 30 * 24 * 60 * 60 * 1000)
          : null;

      if (effectiveExpiry && Number.isFinite(effectiveExpiry.getTime()) && effectiveExpiry.getTime() > Date.now()) {
        hasAccess = true;
        expiresAt = effectiveExpiry.toISOString();
      }
    }

    // Fallback administrativo para trials antigos registrados em assinaturas.
    // Não interfere no acesso pago consultado acima.
    if (!hasAccess && user.email && SUPABASE_SERVICE_ROLE_KEY) {
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
          const st = (sub.status || "").toLowerCase();
          if (!["trial", "active", "ativo", "paid", "aprovado", "pending"].includes(st)) continue;

          let expRaw = sub.expires_at || sub.expira_em;
          if (!expRaw && st === "pending") {
            const createdRaw = sub.created_at || sub.criado_em;
            if (createdRaw) {
              expRaw = new Date(new Date(createdRaw).getTime() + 24 * 60 * 60 * 1000).toISOString();
            }
          }

          if (expRaw && new Date(expRaw).getTime() > Date.now()) {
            hasAccess = true;
            expiresAt = new Date(expRaw).toISOString();
            break;
          }
        }
      } else {
        console.error("ERRO ASSINATURAS:", subResponse.status, await subResponse.text());
      }
    }

    return res.status(200).json({
      authenticated: true,
      hasLifetimeAccess: isLifetime,
      hasAccess,
      paidAt: record?.paid_at || null,
      expiresAt
    });
  } catch (error) {
    console.error("Erro access-status:", error.message);
    return res.status(500).json({ error: "Erro interno" });
  }
};
