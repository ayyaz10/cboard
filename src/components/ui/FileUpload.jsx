/** Accessible, themeable wrapper around the browser file input. */
export function FileUpload({ children, className = '', inputClassName = '', onChange, id, ...inputProps }) {
  return (
    <label className={`ui-file-upload ${className}`.trim()}>
      <span>{children}</span>
      <input id={id} className={inputClassName} type="file" onChange={onChange} {...inputProps} />
    </label>
  );
}
