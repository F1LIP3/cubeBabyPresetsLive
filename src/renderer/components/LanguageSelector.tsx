import { useTranslation } from 'react-i18next';
import { LANGUAGES, changeLanguage, getDirection } from '../../i18n/i18n';
import type { LangCode } from '../../i18n/i18n';

export default function LanguageSelector() {
  const { i18n } = useTranslation();

  return (
    <div className="language-selector">
      <select
        className="language-select"
        value={i18n.language}
        onChange={(e) => {
          changeLanguage(e.target.value as LangCode);
          document.documentElement.dir = getDirection(e.target.value as LangCode);
        }}
      >
        {LANGUAGES.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.native}
          </option>
        ))}
      </select>
    </div>
  );
}
