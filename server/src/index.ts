import express from "express";
import cors from "cors";
import { importsRouter } from "./routes/imports";
import { dataRouter } from "./routes/data";
import { settingsRouter } from "./routes/settings";
import { actionsRouter } from "./routes/actions";

const app = express();
app.use(cors());
app.use(express.json());

app.use("/api/imports", importsRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/actions", actionsRouter);
app.use("/api", dataRouter);

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => {
  console.log(`API escuchando en http://localhost:${PORT}`);
});
