import { Field } from '@strapi/design-system';
import { forwardRef, memo, type ReactNode } from 'react';

type Props = {
  name: string;
  value?: boolean | null;
  onChange: (name: string, value: boolean) => void;
  disabled?: boolean;
  error?: string;
  hint?: ReactNode;
  label?: ReactNode;
  labelAction?: ReactNode;
  required?: boolean;
};

const NewsVisibilityInput = forwardRef<HTMLInputElement, Props>(
  ({ name, value, onChange, disabled, error, labelAction, required }, ref) => {
    const isPublic = value !== false;
    return (
      <Field.Root
        name={name}
        error={error}
        required={required}
        hint="Public articles appear on the website. Admin only articles can be viewed only by signed-in administrators. Publish to apply a visibility change."
      >
        <Field.Label action={labelAction}>Visibility</Field.Label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: disabled ? 'default' : 'pointer', minHeight: 40 }}>
          <span style={{ display: 'inline-flex', position: 'relative', width: 48, height: 26, flexShrink: 0 }}>
            <input
              ref={ref}
              name={name}
              type="checkbox"
              role="switch"
              aria-label="Public visibility"
              checked={isPublic}
              disabled={disabled}
              onChange={(event) => onChange(name, event.target.checked)}
              style={{ appearance: 'none', width: 48, height: 26, margin: 0, border: '1px solid #6b7280', borderRadius: 20, background: isPublic ? '#1f8f57' : '#535762', cursor: 'inherit' }}
            />
            <span aria-hidden style={{ position: 'absolute', top: 4, left: isPublic ? 26 : 4, width: 18, height: 18, borderRadius: '50%', background: '#fff', pointerEvents: 'none', transition: 'left 120ms' }} />
          </span>
          <strong>{isPublic ? 'Public' : 'Admin only'}</strong>
        </label>
        <Field.Hint />
        <Field.Error />
      </Field.Root>
    );
  }
);

NewsVisibilityInput.displayName = 'NewsVisibilityInput';
export default memo(NewsVisibilityInput);
