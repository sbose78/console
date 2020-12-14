import * as React from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ExternalLinkAltIcon } from '@patternfly/react-icons';
import { asAccessReview, Kebab, KebabOption } from '@console/internal/components/utils';
import {
  K8sKind,
  K8sResourceKind,
  PersistentVolumeClaimKind,
  PodKind,
} from '@console/internal/module/k8s';
import { getName, getNamespace, YellowExclamationTriangleIcon } from '@console/shared';
import { confirmModal } from '@console/internal/components/modals';
import { VMIKind, VMKind } from '../../types/vm';
import {
  isVMCreated,
  isVMExpectedRunning,
  isVMRunningOrExpectedRunning,
} from '../../selectors/vm/selectors';
import { getMigrationVMIName } from '../../selectors/vmi-migration';
import { VirtualMachineImportModel, VirtualMachineInstanceMigrationModel } from '../../models';
import { restartVM, startVM, stopVM } from '../../k8s/requests/vm';
import { startVMIMigration } from '../../k8s/requests/vmi';
import { cancelMigration } from '../../k8s/requests/vmim';
import { cloneVMModal } from '../modals/clone-vm-modal';
import { getVMStatus } from '../../statuses/vm/vm-status';
import { isVMIPaused } from '../../selectors/vmi';
import { unpauseVMI } from '../../k8s/requests/vmi/actions';
import { VMImportKind } from '../../types/vm-import/ovirt/vm-import';
import { V1alpha1DataVolume } from '../../types/vm/disk/V1alpha1DataVolume';
import { VMStatusBundle } from '../../statuses/vm/types';
import { confirmVMIModal } from '../modals/menu-actions-modals/confirm-vmi-modal';
import { deleteVMModal } from '../modals/menu-actions-modals/delete-vm-modal';
import { deleteVMIModal } from '../modals/menu-actions-modals/delete-vmi-modal';
import { VMImportWrappper } from '../../k8s/wrapper/vm-import/vm-import-wrapper';
import { StatusGroup } from '../../constants/status-group';
import { cancelVMImport } from '../../k8s/requests/vmimport';
import { ActionMessage } from './constants';

import './menu-actions.scss';

type ActionArgs = {
  vmi?: VMIKind;
  vmStatusBundle?: VMStatusBundle;
};

export const menuActionDeleteVMImport = (
  kindObj: K8sKind,
  vmimport: VMImportKind,
  actionArgs?: ActionArgs,
  innerArgs?: { vm?: VMKind },
): KebabOption => {
  const vmName = new VMImportWrappper(vmimport).getResolvedVMTargetName();
  const DeleteVMImportTitle: React.FC = () => {
    const { t } = useTranslation();
    return (
      <>
        <YellowExclamationTriangleIcon className="co-icon-space-r" />{' '}
        {t('kubevirt-plugin~Cancel Import?')}
      </>
    );
  };

  const vmElem = <strong className="co-break-word">{vmName}</strong>;
  const vmImportElem = <strong className="co-break-word">{getName(vmimport)}</strong>;
  const nsElem = <strong className="co-break-word">{getNamespace(vmimport)}</strong>;

  const DeleteVMImportMessage: React.FC = () => {
    const { t } = useTranslation();
    return innerArgs?.vm ? (
      <>
        {t(
          'kubevirt-plugin~Are you sure you want to cancel importing {{vmImportElem}}? It will also delete the newly created {{vmElem}} in the {{nsElem}} namespace?',
          { vmImportElem, vmElem, nsElem },
        )}
      </>
    ) : (
      <>
        {t(
          'kubevirt-plugin~Are you sure you want to cancel importing {{vmImportElem}} in the {{nsElem}} namespace?',
          { vmImportElem, nsElem },
        )}
      </>
    );
  };

  return {
    // t('kubevirt-plugin~Cancel Import')
    labelKey: 'kubevirt-plugin~Cancel Import',
    callback: () =>
      confirmModal({
        title: <DeleteVMImportTitle />,
        message: <DeleteVMImportMessage />,
        submitDanger: true,
        // t('kubevirt-plugin~Cancel Import')
        btnTextKey: 'kubevirt-plugin~Cancel Import',
        executeFn: () => cancelVMImport(vmimport, innerArgs?.vm),
      }),
    accessReview: asAccessReview(kindObj, vmimport, 'delete'),
  };
};

export const menuActionStart = (
  kindObj: K8sKind,
  vm: VMKind,
  { vmStatusBundle }: ActionArgs,
): KebabOption => {
  const StartMessage: React.FC = () => {
    const name = getName(vm);
    const namespace = getNamespace(vm);
    return (
      <Trans ns="kubevirt-plugin">
        <p>
          This virtual machine will start as soon as the import has been completed. If you proceed
          you will not be able to change this option.
        </p>
        Are you sure you want to start <strong>{name}</strong> in namespace{' '}
        <strong>{namespace}</strong> after it has imported?
      </Trans>
    );
  };

  return {
    hidden: vmStatusBundle?.status?.isMigrating() || isVMRunningOrExpectedRunning(vm),
    // t('kubevirt-plugin~Start Virtual Machine')
    labelKey: 'kubevirt-plugin~Start Virtual Machine',
    callback: () => {
      if (!vmStatusBundle?.status?.isImporting()) {
        startVM(vm);
      } else {
        confirmModal({
          // t('kubevirt-plugin~ Start Virtual Machine')
          titleKey: 'kubevirt-plugin~ Start Virtual Machine',
          message: <StartMessage />,
          // t('kubevirt-plugin~Start')
          btnTextKey: 'kubevirt-plugin~Start',
          executeFn: () => startVM(vm),
        });
      }
    },
    accessReview: asAccessReview(kindObj, vm, 'patch'),
  };
};

const menuActionStop = (
  kindObj: K8sKind,
  vm: VMKind,
  { vmi, vmStatusBundle }: ActionArgs,
): KebabOption => {
  const isImporting = vmStatusBundle?.status?.isImporting();
  return {
    isDisabled: isImporting,
    hidden: !isImporting && !isVMExpectedRunning(vm),
    // t('kubevirt-plugin~Stop Virtual Machine')
    labelKey: 'kubevirt-plugin~Stop Virtual Machine',
    callback: () =>
      confirmVMIModal({
        vmi,
        // t('kubevirt-plugin~Stop Virtual Machine')
        titleKey: 'kubevirt-plugin~Stop Virtual Machine',
        // t('kubevirt-plugin~Stop Virtual Machine alert')
        alertTitleKey: 'kubevirt-plugin~Stop Virtual Machine alert',
        // t('kubevirt-plugin~stop')
        message: <ActionMessage obj={vm} actionKey="kubevirt-plugin~stop" />,
        // t('kubevirt-plugin~Stop')
        btnTextKey: 'kubevirt-plugin~Stop',
        executeFn: () => stopVM(vm),
      }),
    accessReview: asAccessReview(kindObj, vm, 'patch'),
  };
};

const menuActionRestart = (
  kindObj: K8sKind,
  vm: VMKind,
  { vmi, vmStatusBundle }: ActionArgs,
): KebabOption => {
  return {
    hidden:
      vmStatusBundle?.status?.isImporting() ||
      vmStatusBundle?.status?.isMigrating() ||
      !isVMExpectedRunning(vm) ||
      !isVMCreated(vm),
    // t('kubevirt-plugin~Restart Virtual Machine')
    labelKey: 'kubevirt-plugin~Restart Virtual Machine',
    callback: () =>
      confirmVMIModal({
        vmi,
        // t('kubevirt-plugin~Restart Virtual Machine')
        titleKey: 'kubevirt-plugin~Restart Virtual Machine',
        // t('kubevirt-plugin~Restart Virtual Machine alert')
        alertTitleKey: 'kubevirt-plugin~Restart Virtual Machine alert',
        // t('kubevirt-plugin~restart')
        message: <ActionMessage obj={vm} actionKey="kubevirt-plugin~restart" />,
        // t('kubevirt-plugin~Restart')
        btnTextKey: 'kubevirt-plugin~Restart',
        executeFn: () => restartVM(vm),
      }),
    accessReview: asAccessReview(kindObj, vm, 'patch'),
  };
};

const menuActionUnpause = (kindObj: K8sKind, vm: VMKind, { vmi }: ActionArgs): KebabOption => {
  return {
    hidden: !isVMIPaused(vmi),
    // t('kubevirt-plugin~Unpause Virtual Machine')
    labelKey: 'kubevirt-plugin~Unpause Virtual Machine',
    callback: () =>
      confirmModal({
        // t('kubevirt-plugin~Unpause Virtual Machine')
        titleKey: 'kubevirt-plugin~Unpause Virtual Machine',
        // t('kubevirt-plugin~unpause')
        message: <ActionMessage obj={vmi} actionKey="kubevirt-plugin~unpause" />,
        // t('kubevirt-plugin~Unpause')
        btnTextKey: 'kubevirt-plugin~Unpause',
        executeFn: () => unpauseVMI(vmi),
      }),
  };
};

const menuActionMigrate = (
  kindObj: K8sKind,
  vm: VMKind,
  { vmStatusBundle, vmi }: ActionArgs,
): KebabOption => {
  const MigrateMessage: React.FC = () => {
    const name = getName(vmi);
    return (
      <Trans ns="kubevirt-plugin">
        Do you wish to migrate <strong>{name}</strong> vmi to another node?
      </Trans>
    );
  };

  return {
    hidden:
      vmStatusBundle?.status?.isMigrating() ||
      vmStatusBundle?.status?.isError() ||
      vmStatusBundle?.status?.isInProgress() ||
      !isVMRunningOrExpectedRunning(vm),
    // t('kubevirt-plugin~Migrate Virtual Machine')
    labelKey: 'kubevirt-plugin~Migrate Virtual Machine',
    callback: () =>
      confirmModal({
        // t('kubevirt-plugin~Migrate Virtual Machine')
        titleKey: 'kubevirt-plugin~Migrate Virtual Machine',
        message: <MigrateMessage />,
        // t('kubevirt-plugin~Migrate')
        btnTextKey: 'kubevirt-plugin~Migrate',
        executeFn: () => startVMIMigration(vmi),
      }),
  };
};

const menuActionCancelMigration = (
  kindObj: K8sKind,
  vm: VMKind,
  { vmStatusBundle }: ActionArgs,
): KebabOption => {
  const migration = vmStatusBundle?.migration;
  const CancelMigrationMessage: React.FC = () => {
    const name = getMigrationVMIName(migration);
    const namespace = getNamespace(migration);
    return (
      <Trans ns="kubevirt-plugin">
        Are you sure you want to cancel <strong>{name}</strong> migration in{' '}
        <strong>{namespace}</strong> namespace?
      </Trans>
    );
  };

  return {
    hidden: !vmStatusBundle?.status?.isMigrating(),
    // t('kubevirt-plugin~Cancel Virtual Machine Migration')
    labelKey: 'kubevirt-plugin~Cancel Virtual Machine Migration',
    callback: () =>
      confirmModal({
        // t('kubevirt-plugin~Cancel Virtual Machine Migration')
        titleKey: 'kubevirt-plugin~Cancel Virtual Machine Migration',
        message: <CancelMigrationMessage />,
        // t('kubevirt-plugin~Cancel Migration')
        btnTextKey: 'kubevirt-plugin~Cancel Migration',
        executeFn: () => cancelMigration(migration),
      }),
    accessReview:
      migration && asAccessReview(VirtualMachineInstanceMigrationModel, migration, 'delete'),
  };
};

const menuActionClone = (
  kindObj: K8sKind,
  vm: VMKind,
  { vmStatusBundle }: ActionArgs,
): KebabOption => {
  return {
    hidden: vmStatusBundle?.status?.isImporting(),
    // t('kubevirt-plugin~Clone Virtual Machine')
    labelKey: 'kubevirt-plugin~Clone Virtual Machine',
    callback: () => cloneVMModal({ vm }),
    accessReview: asAccessReview(kindObj, vm, 'patch'),
  };
};

export const menuActionDeleteVM = (kindObj: K8sKind, vm: VMKind, vmi: VMIKind): KebabOption => ({
  // t('kubevirt-plugin~Delete Virtual Machine')
  labelKey: 'kubevirt-plugin~Delete Virtual Machine',
  callback: () =>
    deleteVMModal({
      vm,
      vmi,
    }),
  accessReview: asAccessReview(kindObj, vm, 'delete'),
});

export const menuActionDeleteVMorCancelImport = (
  kindObj: K8sKind,
  vm: VMKind,
  actionArgs: ActionArgs,
): KebabOption => {
  const { status, vmImport } = actionArgs.vmStatusBundle;
  if (status.getGroup() === StatusGroup.RHV && !status.isCompleted() && vmImport) {
    return menuActionDeleteVMImport(VirtualMachineImportModel, vmImport, actionArgs, {
      vm,
    });
  }

  return menuActionDeleteVM(kindObj, vm, actionArgs?.vmi);
};

export const menuActionDeleteVMI = (kindObj: K8sKind, vmi: VMIKind): KebabOption => ({
  // t('kubevirt-plugin~Delete Virtual Machine Instance')
  labelKey: 'kubevirt-plugin~Delete Virtual Machine Instance',
  callback: () =>
    deleteVMIModal({
      vmi,
    }),
  accessReview: asAccessReview(kindObj, vmi, 'delete'),
});

export const menuActionOpenConsole = (kindObj: K8sKind, vmi: VMIKind): KebabOption => {
  const OpenConsoleLabel: React.FC = () => {
    const { t } = useTranslation();
    return (
      <>
        {t('kubevirt-plugin~Open Console')}
        <span className="kubevirt-menu-actions__ext-link-icon">
          <ExternalLinkAltIcon />
        </span>
      </>
    );
  };

  return {
    label: <OpenConsoleLabel />,
    callback: () =>
      window.open(
        `/k8s/ns/${getNamespace(vmi)}/virtualmachineinstances/${getName(vmi)}/standaloneconsole`,
        `${getName(vmi)}-console}`,
        'modal=yes,alwaysRaised=yes,location=yes,width=1024,height=768',
      ),
  };
};

export const vmMenuActions = [
  menuActionStart,
  menuActionStop,
  menuActionRestart,
  menuActionUnpause,
  menuActionMigrate,
  menuActionCancelMigration,
  menuActionClone,
  menuActionOpenConsole,
  Kebab.factory.ModifyLabels,
  Kebab.factory.ModifyAnnotations,
  menuActionDeleteVMorCancelImport,
];

export const vmiMenuActions = [
  Kebab.factory.ModifyLabels,
  Kebab.factory.ModifyAnnotations,
  menuActionDeleteVMI,
];

export const vmImportMenuActions = [
  Kebab.factory.ModifyLabels,
  Kebab.factory.ModifyAnnotations,
  menuActionDeleteVMImport,
];

export type ExtraResources = {
  vmis: VMIKind[];
  pods: PodKind[];
  migrations: K8sResourceKind[];
  pvcs?: PersistentVolumeClaimKind[];
  dataVolumes: V1alpha1DataVolume[];
  vmImports: VMImportKind[];
};

export const vmMenuActionsCreator = (
  kindObj: K8sKind,
  vm: VMKind,
  { vmis, pods, migrations, vmImports, pvcs, dataVolumes }: ExtraResources,
) => {
  const vmi = vmis && vmis[0];
  const vmStatusBundle = getVMStatus({ vm, vmi, pods, migrations, pvcs, dataVolumes, vmImports });

  return vmMenuActions.map((action) => {
    return action(kindObj, vm, { vmi, vmStatusBundle });
  });
};

export const vmiMenuActionsCreator = (kindObj: K8sKind, vmi: VMIKind) => {
  return vmiMenuActions.map((action) => {
    return action(kindObj, vmi);
  });
};
