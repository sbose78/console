package helm_actions

import (
	"fmt"
	"github.com/openshift/console/pkg/helm_agent"
	"helm.sh/helm/v3/pkg/action"
	"strconv"
)

func RollbackRelease(name, version string) (interface{}, error) {
	cmd := action.NewRollback(helm_agent.GetActionConfigurations())
	ver, err := strconv.Atoi(version)
	if err != nil {
		return nil, fmt.Errorf("could not convert revision to a number: %v", err)
	}
	cmd.Version = ver
	err = cmd.Run(name)
	if err != nil {
		return nil, err
	}
	res := make(map[string]string)
	res["msg"] = "Rollback successful"
	return res, nil
}
