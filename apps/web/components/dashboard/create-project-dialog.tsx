/**
 * @fileoverview Create project dialog — modal form for adding a new project.
 *
 * Calls `POST /api/projects` on submit and invokes `onSuccess()` so the parent
 * can refresh the projects list.
 *
 * @layer components/dashboard
 */

'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod/v4';
import { toast } from 'sonner';
import { FolderPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { createProject, handleAuthClientError } from '@/lib/auth-client';

const createProjectSchema = z.object({
  name: z.string().min(1, 'Project name is required').max(100, 'Name is too long'),
});

type CreateProjectValues = z.infer<typeof createProjectSchema>;

interface CreateProjectDialogProps {
  /** Called after a project is created so the parent can refresh its list. */
  onSuccess: () => void;
}

/**
 * Button that opens a modal form for creating a new project.
 *
 * @param onSuccess - Callback invoked after the project is created.
 */
export function CreateProjectDialog({ onSuccess }: CreateProjectDialogProps) {
  const [open, setOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<CreateProjectValues>({
    resolver: zodResolver(createProjectSchema),
    mode: 'onSubmit',
    reValidateMode: 'onChange',
  });

  const onSubmit = async (data: CreateProjectValues) => {
    setIsPending(true);
    try {
      await createProject(data.name);
      toast.success(`Project "${data.name}" created.`);
      reset();
      setOpen(false);
      onSuccess();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="bg-[#ff6224] text-white hover:bg-[#e5551f]">
          <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
          New project
        </Button>
      </DialogTrigger>

      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create project</DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="projectName" className="text-xs text-[rgba(255,255,255,0.6)]">
              Project name
            </Label>
            <Input
              id="projectName"
              placeholder="My project"
              autoFocus
              {...register('name')}
              className={errors.name ? 'border-red-500/60' : ''}
            />
            {errors.name && <p className="text-xs text-red-400">{errors.name.message}</p>}
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isPending}
              className="bg-[#ff6224] text-white hover:bg-[#e5551f]"
            >
              {isPending ? 'Creating…' : 'Create'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
