package helm_actions

import (
	"helm.sh/helm/v3/pkg/action"
)

func ListReleases(conf *action.Configuration) (interface{}, error) {
	cmd := action.NewList(conf)
	cmd.AllNamespaces = true
	cmd.All = true

	releases, err := cmd.Run()
	if err != nil {
		return nil, err
	}
	return releases, nil
}
