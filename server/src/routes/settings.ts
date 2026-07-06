import { Router } from "express";
import { getSettings, saveSettings } from "../db";
import { DEFAULT_SETTINGS, type Settings } from "../../../shared/src";

export const settingsRouter = Router();

settingsRouter.get("/", (_req, res) => {
  res.json(getSettings());
});

settingsRouter.put("/", (req, res) => {
  const body = req.body as Partial<Settings>;
  const next: Settings = { ...DEFAULT_SETTINGS, ...getSettings(), ...body };
  if (next.targetAcosGlobal <= 0 || next.targetAcosGlobal >= 2)
    return res.status(400).json({ error: "Target ACOS global fuera de rango (0–200%)" });
  if (next.minSpendPause < 0 || next.minOrdersWinner < 0 || next.minClicksData < 0)
    return res.status(400).json({ error: "Los umbrales no pueden ser negativos" });
  saveSettings(next);
  res.json(next);
});
