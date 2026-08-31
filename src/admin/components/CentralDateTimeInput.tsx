import { DateTimePicker, Field } from '@strapi/design-system';
import { forwardRef, memo, useMemo, useState, type ReactNode } from 'react';
import { useIntl } from 'react-intl';

const CENTRAL_TIME_ZONE = 'America/Chicago';
const MAX_DATE = new Date(2099, 11, 31, 23, 59, 59);

type DateParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

type CentralDateTimeInputProps = {
  disabled?: boolean;
  error?: string;
  hint?: ReactNode;
  label?: ReactNode;
  labelAction?: ReactNode;
  name: string;
  onChange: (name: string, value: string | null) => void;
  required?: boolean;
  value?: unknown;
};

const centralFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: CENTRAL_TIME_ZONE,
  calendar: 'iso8601',
  numberingSystem: 'latn',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const getCentralParts = (date: Date): DateParts => {
  const values = Object.fromEntries(
    centralFormatter
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );

  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
  };
};

const partsMatch = (left: DateParts, right: DateParts): boolean =>
  left.year === right.year &&
  left.month === right.month &&
  left.day === right.day &&
  left.hour === right.hour &&
  left.minute === right.minute &&
  left.second === right.second;

const getCentralOffsetMilliseconds = (instant: Date): number => {
  const parts = getCentralParts(instant);
  const centralWallClockAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  const instantWithoutMilliseconds = Math.trunc(instant.getTime() / 1000) * 1000;

  return centralWallClockAsUtc - instantWithoutMilliseconds;
};

/**
 * Convert wall-clock values selected by the browser-local picker into the
 * corresponding America/Chicago instant. Strapi continues to store UTC ISO.
 */
export const centralWallClockToIso = (pickerDate: Date): string => {
  const selected: DateParts = {
    year: pickerDate.getFullYear(),
    month: pickerDate.getMonth() + 1,
    day: pickerDate.getDate(),
    hour: pickerDate.getHours(),
    minute: pickerDate.getMinutes(),
    second: pickerDate.getSeconds(),
  };
  const wallClockAsUtc = Date.UTC(
    selected.year,
    selected.month - 1,
    selected.day,
    selected.hour,
    selected.minute,
    selected.second
  );

  let candidate = wallClockAsUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const offset = getCentralOffsetMilliseconds(new Date(candidate));
    const nextCandidate = wallClockAsUtc - offset;

    if (nextCandidate === candidate) {
      break;
    }

    candidate = nextCandidate;
  }

  const result = new Date(candidate);
  if (!partsMatch(getCentralParts(result), selected)) {
    throw new Error(
      'That wall-clock time does not exist in Central Time because of the daylight-saving transition.'
    );
  }

  return result.toISOString();
};

/**
 * Shift a real UTC instant into a browser-local Date carrying the same wall
 * values as America/Chicago. This keeps the stock Strapi picker usable while
 * making its display independent of the operator's computer timezone.
 */
export const isoToCentralPickerDate = (value: string): Date | undefined => {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    return undefined;
  }

  const parts = getCentralParts(instant);
  return new Date(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
};

const CentralDateTimeInput = forwardRef<HTMLInputElement, CentralDateTimeInputProps>(
  ({ disabled, error, hint, label, labelAction, name, onChange, required, value }, ref) => {
    const { formatMessage } = useIntl();
    const [conversionError, setConversionError] = useState<string>();
    const pickerValue = useMemo(
      () => (typeof value === 'string' ? isoToCentralPickerDate(value) : undefined),
      [value]
    );
    const centralHint = (
      <>
        {hint ? (
          <>
            {hint}
            <br />
          </>
        ) : null}
        Enter the event's local Central Time. CDT/CST is selected automatically for the date.
      </>
    );

    return (
      <Field.Root
        error={conversionError || error}
        hint={centralHint}
        name={name}
        required={required}
      >
        <Field.Label action={labelAction}>{label} (Central Time)</Field.Label>
        <DateTimePicker
          ref={ref}
          clearLabel={formatMessage({ id: 'clearLabel', defaultMessage: 'Clear' })}
          disabled={disabled}
          maxDate={MAX_DATE}
          onChange={(date) => {
            if (!date) {
              setConversionError(undefined);
              onChange(name, null);
              return;
            }

            try {
              onChange(name, centralWallClockToIso(date));
              setConversionError(undefined);
            } catch (conversionFailure) {
              setConversionError(
                conversionFailure instanceof Error
                  ? conversionFailure.message
                  : 'Could not convert this Central Time value.'
              );
            }
          }}
          onClear={() => {
            setConversionError(undefined);
            onChange(name, null);
          }}
          value={pickerValue}
        />
        <Field.Hint />
        <Field.Error />
      </Field.Root>
    );
  }
);

CentralDateTimeInput.displayName = 'CentralDateTimeInput';

export default memo(CentralDateTimeInput);
