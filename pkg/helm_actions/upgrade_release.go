package helm_actions

import (
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart/loader"
	"helm.sh/helm/v3/pkg/cli"
)

func UpgradeRelease(ns, name, url string, conf *action.Configuration) (interface{}, error) {
	cmd := action.NewInstall(conf)
	cmd.Namespace = ns

	name, chart, err := cmd.NameAndChart([]string{name, url})
	if err != nil {
		return nil, err
	}
	cmd.ReleaseName = name

	cp, err := cmd.ChartPathOptions.LocateChart(chart, cli.New())
	if err != nil {
		return nil, err
	}

	ch, err := loader.Load(cp)
	if err != nil {
		return nil, err
	}

	upgradeCmd := action.NewUpgrade(conf)
	release, err := upgradeCmd.Run(name, ch, nil)
	return release, err
}
