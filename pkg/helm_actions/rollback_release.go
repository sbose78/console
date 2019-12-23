package helm_actions

import (
	"fmt"
	"helm.sh/helm/v3/pkg/action"
	"strconv"
)

func RollbackRelease(name, version string, conf *action.Configuration) (interface{}, error) {
	cmd := action.NewRollback(conf)
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
