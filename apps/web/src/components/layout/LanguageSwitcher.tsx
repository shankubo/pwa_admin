import { useTranslation } from "react-i18next";
import { Card, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { useLanguageStore } from "@/stores/language.store";
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation("settings");
  const setLanguage = useLanguageStore((s) => s.setLanguage);
  const current = i18n.resolvedLanguage as SupportedLanguage | undefined;

  return (
    <Card>
      <CardTitle>{t("language.title")}</CardTitle>
      <div className="flex gap-2">
        {SUPPORTED_LANGUAGES.map((lang) => (
          <Button
            key={lang}
            type="button"
            size="sm"
            variant={current === lang ? "default" : "outline"}
            className={cn(current === lang && "pointer-events-none")}
            onClick={() => setLanguage(lang)}
          >
            {t(`language.${lang}`)}
          </Button>
        ))}
      </div>
    </Card>
  );
}
