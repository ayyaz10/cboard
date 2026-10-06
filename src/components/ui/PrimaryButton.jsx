import { Button } from './Button';

export function PrimaryButton({ children, type = 'button', className = '', ...props }) {
  return (
    <Button
      type={type}
      {...props}
      variant="primary"
      className={`primary-button w-full sm:w-auto ${className}`}
    >
      {children}
    </Button>
  );
}
