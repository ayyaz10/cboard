export function FormField({ label, htmlFor, help, error, children, className = '' }) {
  return <div className={`ui-form-field ${className}`}>
    {label && <label htmlFor={htmlFor}>{label}</label>}
    {children}
    {help && <small>{help}</small>}
    {error && <small className="ui-form-field__error" role="alert">{error}</small>}
  </div>;
}
