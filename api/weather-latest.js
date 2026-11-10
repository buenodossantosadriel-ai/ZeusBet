
const CAMERAS = [
  { id: "ptz_caxias", nome: "Caxias do Sul", lat: -29.1678, lng: -51.1794 },
  { id: "ptz_farroupilha", nome: "Farroupilha", lat: -29.2247, lng: -51.3454 },
  { id: "ptz_gramado2", nome: "Gramado", lat: -29.3742, lng: -50.876 },
  { id: "ptz_igrejinha", nome: "Igrejinha", lat: -29.573, lng: -50.788 },
  { id: "ptz_portao", nome: "Portão", lat: -29.703, lng: -51.028 },
  { id: "ptz_montenegro", nome: "Montenegro", lat: -29.6877, lng: -51.4644 },
  { id: "ptz_itati", nome: "Itati", lat: -29.496, lng: -50.102 },
  { id: "ptz_passo_fundo", nome: "Passo Fundo", lat: -28.379969, lng: -52.252853 },
  { id: "ptz_santa_maria", nome: "Santa Maria", lat: -29.6842, lng: -53.8069 },
  { id: "ptz_ijui", nome: "Ijuí", lat: -28.3875, lng: -53.915 },
  { id: "ptz_restinga_seca", nome: "Restinga Seca", lat: -29.812, lng: -53.373 },
  { id: "Serafina_Correa", nome: "Serafina Corrêa", lat: -28.711, lng: -51.934 },
  { id: "Sananduva", nome: "Sananduva", lat: -27.948, lng: -51.808 }
];

module.exports = async function handler(req, res) {
  res.setHeader(
    "Cache-Control",
    "public, s-maxage=600, stale-while-revalidate=300"
  );

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({
      success: false,
      error: "Método não permitido."
    });
  }

  const apiKey = process.env.WEATHERAPI_KEY;

  if (!apiKey) {
    return res.status(500).json({
      success: false,
      error: "Chave WEATHERAPI_KEY não configurada na Vercel."
    });
  }

  try {
    const results = await Promise.all(
      CAMERAS.map(async (camera) => {
        const url = new URL(
          "https://api.weatherapi.com/v1/current.json"
        );

        url.searchParams.set("key", apiKey);
        url.searchParams.set(
          "q",
          `${camera.lat},${camera.lng}`
        );
        url.searchParams.set("lang", "pt");

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok) {
          return {
            id: camera.id,
            localidade: camera.nome,
            success: false,
            error: data.error?.message ||
              `WeatherAPI HTTP ${response.status}`
          };
        }

        return {
          id: camera.id,
          localidade: camera.nome,
          success: true,
          temperatura_c: data.current.temp_c,
          sensacao_termica_c: data.current.feelslike_c,
          umidade_pct: data.current.humidity,
          vento_kmh: data.current.wind_kph,
          rajada_kmh: data.current.gust_kph,
          chuva_mm: data.current.precip_mm,
          condicao: data.current.condition.text,
          icone: data.current.condition.icon,
          atualizado_em: data.current.last_updated,
          fonte: "WeatherAPI"
        };
      })
    );

    const successful = results.filter(
      item => item.success
    ).length;

    return res.status(200).json({
      success: successful > 0,
      fonte: "WeatherAPI",
      tipo_dado:
        "Condição meteorológica atual fornecida pela WeatherAPI; não é medição oficial do INMET.",
      total_localidades: CAMERAS.length,
      consultadas_com_sucesso: successful,
      falhas: CAMERAS.length - successful,
      cache_segundos: 600,
      consultado_em: new Date().toISOString(),
      localidades: results
    });

  } catch (error) {
    console.error("Erro WeatherAPI:", error.message);

    return res.status(502).json({
      success: false,
      error: "Não foi possível consultar as localidades no WeatherAPI."
    });
  }
};
