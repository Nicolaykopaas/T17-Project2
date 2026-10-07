import type { ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';

interface Props {
  /** Hvor lenka går ved direkte åpning, når det ikke finnes noen «forrige» side i appen. */
  fallbackTo: string;
  fallbackLabel: ReactNode;
  /** Etikett på tilbake-knappen. Vi vet ikke sikkert hvor historikken fører, så den nevner ikke målet. */
  label?: ReactNode;
}

/**
 * Innen appen brukes historikken (`navigate(-1)`), så resultater og scrollposisjon er intakt og sidene
 * ikke havner i en sirkel av push-navigasjoner (tittel → spiller → tittel → …). Ved direkte åpning
 * (`key === 'default'`) finnes ingen «forrige», og da er en vanlig lenke eneste riktige valg.
 */
export function BackLink({ fallbackTo, fallbackLabel, label = '← Tilbake' }: Props) {
  const navigate = useNavigate();
  const { key } = useLocation();
  if (key === 'default') {
    return (
      <p className="backlink">
        <Link to={fallbackTo}>{fallbackLabel}</Link>
      </p>
    );
  }
  return (
    <p className="backlink">
      <button type="button" className="btn btn--link" onClick={() => void navigate(-1)}>
        {label}
      </button>
    </p>
  );
}
