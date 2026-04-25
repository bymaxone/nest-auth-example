/**
 * @fileoverview Projects list — displays tenant projects with a delete action.
 *
 * Fetches from `GET /api/projects` on mount and whenever `refreshKey` changes.
 * Admin users also see a delete button per project row.
 *
 * @layer components/dashboard
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { FolderOpen, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { listProjects, deleteProject, handleAuthClientError } from '@/lib/auth-client';
import type { ProjectInfo } from '@/lib/auth-client';

interface ProjectsListProps {
  /** When true, render the delete button for each project. */
  isAdmin: boolean;
  /** Increment to force a reload. */
  refreshKey: number;
}

/**
 * Renders all projects for the current tenant.
 *
 * @param isAdmin    - Renders delete controls when true.
 * @param refreshKey - Increment to trigger a data reload.
 */
export function ProjectsList({ isAdmin, refreshKey }: ProjectsListProps) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const handleDelete = async (id: string, name: string) => {
    setDeleting(id);
    try {
      await deleteProject(id);
      toast.success(`Project "${name}" deleted.`);
      await load();
    } catch (err) {
      handleAuthClientError(err, { toast });
    } finally {
      setDeleting(null);
    }
  };

  if (isLoading) {
    return <p className="text-sm text-[rgba(255,255,255,0.4)]">Loading projects…</p>;
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-[rgba(255,255,255,0.25)]">
        <FolderOpen className="h-8 w-8" />
        <p className="text-sm">No projects yet.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[rgba(255,255,255,0.06)]">
      {projects.map((project) => (
        <div
          key={project.id}
          className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
        >
          <div className="flex items-center gap-3">
            <FolderOpen className="h-4 w-4 shrink-0 text-[#ff6224]" />
            <div>
              <p className="text-sm font-medium text-[rgba(255,255,255,0.85)]">{project.name}</p>
              <p className="text-xs text-[rgba(255,255,255,0.35)]">
                Created {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
              </p>
            </div>
          </div>

          {isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete project ${project.name}`}
                  disabled={deleting === project.id}
                  className="h-7 w-7 text-[rgba(255,255,255,0.3)] hover:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete &ldquo;{project.name}&rdquo;?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This project will be permanently deleted. This action cannot be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void handleDelete(project.id, project.name)}>
                    Delete project
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
      ))}
    </div>
  );
}
