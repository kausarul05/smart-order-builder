import { formatBdt, formatPoisha } from '@/domain/money';
import type { PriceBreakdown } from '@/domain/types';
import type { PricePreview } from './usePricePreview';

/**
 * The full breakdown the brief asks to be shown: subtotal, each discount,
 * VAT and payable. It is also where TC-12's two visible behaviours live -
 * a Retry button on failure, and the configuration surviving that failure.
 */
export function PriceBreakdownPanel(props: {
  readonly preview: PricePreview;
  readonly qty: number;
  /**
   * Only ever rendered for a valid configuration - an invalid one shows
   * the checklist instead, which says what is missing and where.
   */
  readonly enabled: boolean;
  readonly vatPercent: number;
}) {
  const { preview, vatPercent } = props;

  if (preview.error !== null) {
    const trouble = describeFailure(preview.errorCode);
    return (
      <div
        className="mt-4 rounded-xl border px-3.5 py-3 text-sm"
        style={{ background: 'var(--warn-soft)', borderColor: 'var(--warn)' }}
        role="alert"
      >
        <p className="font-semibold" style={{ color: 'var(--warn)' }}>
          {trouble.headline}
        </p>
        <p className="mt-1" style={{ color: 'var(--text)' }}>
          {trouble.body}
        </p>
        {trouble.retryable ? (
          <button
            type="button"
            onClick={preview.retry}
            className="mt-2.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            Try the price again
          </button>
        ) : (
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-2.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
            style={{ background: 'var(--accent)', color: 'var(--accent-ink)' }}
          >
            Reload the page
          </button>
        )}
      </div>
    );
  }

  const { breakdown } = preview;

  return (
    <div
      className="mt-4 rounded-xl border p-4"
      style={{ borderColor: 'var(--border)' }}
      aria-busy={preview.loading}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Price</h3>
        {preview.loading && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            pricing…
          </span>
        )}
      </div>

      {breakdown === null ? (
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          Waiting for the first price…
        </p>
      ) : (
        <Breakdown breakdown={breakdown} vatPercent={vatPercent} />
      )}
    </div>
  );
}

function Breakdown(props: {
  readonly breakdown: PriceBreakdown;
  readonly vatPercent: number;
}) {
  const { breakdown, vatPercent } = props;
  const line = breakdown.lines[0];

  return (
    <dl className="mt-2 space-y-1 text-sm tnum">
      {line !== undefined && (
        <>
          <Row label="Options and base" value={formatPoisha(line.unit.step1)} />
          {line.unit.extrasDealOff > 0 && (
            <Row
              label="Extras deal (every 3rd cheapest free)"
              value={`−${formatPoisha(line.unit.extrasDealOff)}`}
              muted
            />
          )}
          {line.unit.comboOff > 0 && (
            <Row
              label="Combo discount"
              value={`−${formatPoisha(line.unit.comboOff)}`}
              muted
            />
          )}
          <Row
            label={`Unit price${line.unit.locked ? ' (locked)' : ''}`}
            value={formatPoisha(line.unit.unitPrice)}
          />
          <Row label={`Line total × ${line.qty}`} value={formatPoisha(line.lineTotal)} />
        </>
      )}

      <Row label="Cart subtotal" value={formatPoisha(breakdown.subtotal)} />

      {breakdown.candidates.map((candidate) => (
        <Row
          key={candidate.id}
          label={`${candidate.id}${candidate.code === null ? '' : ` · ${candidate.code}`}`}
          value={
            candidate.id === breakdown.discount?.id
              ? `−${formatPoisha(candidate.amount)}`
              : (candidate.reason ?? 'not applied')
          }
          muted={candidate.id !== breakdown.discount?.id}
        />
      ))}

      <Row
        label="Discounted subtotal"
        value={formatPoisha(breakdown.discountedSubtotal)}
      />
      <Row label={`VAT ${vatPercent}%`} value={formatPoisha(breakdown.vat)} />

      <div
        className="flex justify-between gap-4 border-t pt-2 text-base font-semibold"
        style={{ borderColor: 'var(--border)' }}
      >
        <dt>Payable</dt>
        <dd>{formatBdt(breakdown.payable)}</dd>
      </div>
    </dl>
  );
}

function Row(props: {
  readonly label: string;
  readonly value: string;
  readonly muted?: boolean;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt style={{ color: 'var(--text-muted)' }}>{props.label}</dt>
      <dd style={props.muted === true ? { color: 'var(--text-muted)' } : undefined}>
        {props.value}
      </dd>
    </div>
  );
}

/**
 * What to tell someone standing at the till when `/price` does not answer.
 *
 * The wire message is the server's own ("Pricing service hiccuped"), which
 * is useful in devtools and useless on a screen: it names a component the
 * reader does not have and leaves the real question — "did I lose my
 * plate?" — unanswered. So the panel owns the wording, and the only thing
 * it takes from the server is which of these three situations it is in.
 */
function describeFailure(code: string | null): {
  readonly headline: string;
  readonly body: string;
  readonly retryable: boolean;
} {
  if (code === 'mock_server_missing') {
    return {
      headline: 'The menu service stopped answering',
      body:
        'Everything you picked is still here. Reloading the page reconnects it — nothing in your order is lost.',
      retryable: false,
    };
  }
  if (code === 'network') {
    return {
      headline: 'No connection, so no price yet',
      body:
        'Your plate is exactly as you left it. Once you are back online, ask for the price again.',
      retryable: true,
    };
  }
  return {
    headline: 'Could not get a price just now',
    body:
      'The price service did not answer this time. Nothing you picked has changed — ask again and it usually comes straight back.',
    retryable: true,
  };
}
