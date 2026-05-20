"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { savePrompt, resetPrompt } from "@/app/actions/save-prompt";
import { PROMPT_SEPARATOR, type PromptKey } from "@/lib/ai/prompt-settings";

type PromptMode = "system_only" | "user_only" | "system_and_user";

type PromptConfig = {
  key: PromptKey;
  title: string;
  description: string;
  mode: PromptMode;
  defaultSystem?: string;
  defaultUser?: string;
  variables?: { name: string; description: string }[];
};

type Props = {
  prompts: {
    sqmSystem: string;
    sqmUser: string;
    qqpSystem: string;
    qqpUserTemplate: string;
    pageClassification: string;
    metadataUser: string;
  };
  defaults: {
    sqmSystem: string;
    sqmUser: string;
    qqpSystem: string;
    qqpUserTemplate: string;
    pageClassification: string;
    metadataUser: string;
  };
};

const CONFIGS: PromptConfig[] = [
  {
    key: "prompt_sqm_extraction",
    title: "SQM Extraction",
    description: "Extracts room-by-room surface areas from floor plan images and PDFs.",
    mode: "system_and_user",
    variables: [],
  },
  {
    key: "prompt_qqp_extraction",
    title: "QQP Extraction",
    description: "Evaluates finishing quality parameters from extracted plan data and computes the finishing coefficient.",
    mode: "system_and_user",
    variables: [
      { name: "{sqm_extraction_json}", description: "Full JSON output from the SQM extraction step" },
      { name: "{list_of_active_qqp_definitions}", description: "Current active QQP definitions with names, types, and descriptions" },
      { name: "{known_data_section}", description: "Known price/coefficient/expert notes (only present for reference dossiers)" },
    ],
  },
  {
    key: "prompt_page_classification",
    title: "Page Classification",
    description: "Classifies PDF pages as floor_plan, expert_report, photo, pricing_table, cover, or other.",
    mode: "system_only",
    variables: [],
  },
  {
    key: "prompt_metadata_extraction",
    title: "Metadata Extraction",
    description: "Extracts address, postcode, building type, price, and expert notes from insurance dossier pages.",
    mode: "user_only",
    variables: [],
  },
];

function PromptBlock({
  config,
  systemText,
  userText,
  defaults,
}: {
  config: PromptConfig;
  systemText: string;
  userText: string;
  defaults: { system: string; user: string };
}) {
  const [system, setSystem] = useState(systemText);
  const [user, setUser] = useState(userText);
  const [saved, setSaved] = useState(false);
  const [isPending, startTransition] = useTransition();

  const combined =
    config.mode === "system_and_user"
      ? `${system}${PROMPT_SEPARATOR}${user}`
      : config.mode === "system_only"
        ? system
        : user;

  const charCount = combined.length;
  const isDirty =
    config.mode === "system_and_user"
      ? system !== systemText || user !== userText
      : config.mode === "system_only"
        ? system !== systemText
        : user !== userText;

  function handleSave() {
    startTransition(async () => {
      await savePrompt(config.key, combined);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  function handleReset() {
    startTransition(async () => {
      await resetPrompt(config.key);
      setSystem(defaults.system);
      setUser(defaults.user);
    });
  }

  return (
    <div className="rounded-lg border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-medium">{config.title}</h3>
          <p className="text-sm text-muted-foreground mt-0.5">{config.description}</p>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap pt-1">
          {charCount.toLocaleString()} chars
        </span>
      </div>

      {(config.mode === "system_and_user" || config.mode === "system_only") && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            System Prompt
          </label>
          <Textarea
            value={system}
            onChange={(e) => setSystem(e.target.value)}
            className="font-mono text-xs min-h-[180px] resize-y"
            spellCheck={false}
          />
        </div>
      )}

      {(config.mode === "system_and_user" || config.mode === "user_only") && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            User Prompt
          </label>
          <Textarea
            value={user}
            onChange={(e) => setUser(e.target.value)}
            className="font-mono text-xs min-h-[180px] resize-y"
            spellCheck={false}
          />
        </div>
      )}

      {config.variables && config.variables.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors list-none flex items-center gap-1">
            <span className="group-open:rotate-90 transition-transform inline-block">▶</span>
            Available variables
          </summary>
          <div className="mt-2 space-y-1.5">
            {config.variables.map((v) => (
              <div key={v.name} className="flex items-start gap-2">
                <Badge variant="outline" className="font-mono text-xs shrink-0">
                  {v.name}
                </Badge>
                <span className="text-xs text-muted-foreground">{v.description}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex items-center justify-between pt-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleReset}
          disabled={isPending}
          className="text-muted-foreground"
        >
          Reset to default
        </Button>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isPending || (!isDirty && !saved)}
        >
          {isPending ? "Saving…" : saved ? "Saved" : "Save"}
        </Button>
      </div>
    </div>
  );
}

export function PromptSettings({ prompts, defaults }: Props) {
  return (
    <div className="space-y-4">
      {CONFIGS.map((config) => {
        let systemText = "";
        let userText = "";
        let defaultSystem = "";
        let defaultUser = "";

        if (config.key === "prompt_sqm_extraction") {
          systemText = prompts.sqmSystem;
          userText = prompts.sqmUser;
          defaultSystem = defaults.sqmSystem;
          defaultUser = defaults.sqmUser;
        } else if (config.key === "prompt_qqp_extraction") {
          systemText = prompts.qqpSystem;
          userText = prompts.qqpUserTemplate;
          defaultSystem = defaults.qqpSystem;
          defaultUser = defaults.qqpUserTemplate;
        } else if (config.key === "prompt_page_classification") {
          systemText = prompts.pageClassification;
          defaultSystem = defaults.pageClassification;
        } else if (config.key === "prompt_metadata_extraction") {
          userText = prompts.metadataUser;
          defaultUser = defaults.metadataUser;
        }

        return (
          <PromptBlock
            key={config.key}
            config={config}
            systemText={systemText}
            userText={userText}
            defaults={{ system: defaultSystem, user: defaultUser }}
          />
        );
      })}
    </div>
  );
}
