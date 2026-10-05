import { toast } from 'sonner';

export const notify = {
  success: (message, options) => toast.success(message, options),
  info: (message, options) => toast.info(message, options),
  warning: (message, options) => toast.warning(message, options),
  error: (message, options) => toast.error(message, options),
  dismiss: id => toast.dismiss(id),
};
