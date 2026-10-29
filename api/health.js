export default function handler(req, res) {
res.status(200).json({
status: "online",
projeto: "ZeusBet",
mensagem: "API funcionando corretamente!"
});
}
