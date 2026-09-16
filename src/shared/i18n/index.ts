import { join } from "node:path";
import { I18nModule as NestI18nModule, AcceptLanguageResolver, HeaderResolver } from "nestjs-i18n";

export const DEFAULT_LOCALE = "pt-BR";
export const FALLBACK_LOCALE = "en-US";

export const I18nModule = NestI18nModule.forRoot({
  fallbackLanguage: FALLBACK_LOCALE,
  loaderOptions: {
    path: join(__dirname, "locales"),
    watch: true,
  },
  resolvers: [new HeaderResolver(["x-lang"]), AcceptLanguageResolver],
});
