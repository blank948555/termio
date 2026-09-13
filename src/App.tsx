import { useEffect, useMemo, useState } from "react";
import Onboarding from "./onboarding/Onboarding";
import Terminal from "./terminal/Terminal";
import { loadSettings, saveSettings, type Settings } from "./lib/storage";
import { listModels, TermioError } from "./lib/openrouter";
import type { ModelInfo } from "./lib/models";

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);

  useEffect(() => {
    if (!settings.setupComplete || !settings.apiKey) return;
    let cancelled = false;
    setModelsError(null);
    listModels(settings.apiKey)
      .then((m) => {
        if (cancelled) return;
        setModels(m);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof TermioError) setModelsError(e.message);
        else setModelsError("Could not load the OpenRouter model catalog.");
      });
    return () => {
      cancelled = true;
    };
  }, [settings.setupComplete, settings.apiKey]);

  function completeSetup(next: Partial<Settings>) {
    const merged = saveSettings({ ...next, setupComplete: true });
    setSettings(merged);
  }

  function updateSettings(patch: Partial<Settings>) {
    const merged = saveSettings(patch);
    setSettings(merged);
  }

  const selectedModel = useMemo(
    () => models.find((m) => m.id === settings.modelId) ?? null,
    [models, settings.modelId]
  );

  if (!settings.setupComplete) {
    return <Onboarding onComplete={completeSetup} settings={settings} />;
  }

  return (
    <Terminal
      settings={settings}
      models={models}
      modelsError={modelsError}
      selectedModel={selectedModel}
      onSettingsChange={updateSettings}
      onReloadModels={() => {
        setModelsError(null);
        listModels(settings.apiKey)
          .then(setModels)
          .catch((e) =>
            setModelsError(
              e instanceof TermioError ? e.message : "Could not load models."
            )
          );
      }}
      onOpenSettings={null}
    />
  );
}
